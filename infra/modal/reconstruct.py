"""
HouseTour — Modal reconstruction service.

This Modal app hosts the GPU-accelerated reconstruction stages that cannot
run on the CPU-only Next.js/BullMQ workers:

  - colmap_dense_mesh: real SfM + dense reconstruction -> textured GLB
  - train_gaussian_splat: 3D Gaussian Splatting -> .ply/.splat

Phase 1 (this file) ships a `gpu_probe` endpoint to verify the CUDA/GPU loop
works end to end before the heavy engines are wired in. The actual engines
are added in the next phase (same file, new functions).

Invocation model
----------------
The Node BullMQ worker does NOT need a GPU. It POSTs a job to the Modal web
endpoint (authenticated with MODAL_WEBHOOK_SECRET), Modal spins up a GPU
container on demand, the work runs, results are uploaded to object storage
(R2/MinIO), and progress is reported back via the callback URL. Scale-to-zero
means idle cost is $0.

Local dev / fallback
-------------------
When MODAL_WEBHOOK_URL is not configured, the pipeline falls back to the
CPU software reconstruction (capture-layout proxy + textured room mesh)
so the product still works without GPU spend.
"""

import os

import modal

# --------------------------------------------------------------------------
# Image: CUDA runtime + PyTorch (GPU). This is what makes `gpu_probe` able to
# report a real CUDA device. The heavy engines (Phase 2) add COLMAP + gsplat.
# --------------------------------------------------------------------------
cuda_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("wget", "git", "colmap", "libgl1", "libgomp1", "xvfb")
    .pip_install(
        "torch==2.2.2",
        "numpy==1.26.4",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install("fastapi[standard]", "open3d==0.18.0", "boto3==1.34.0")
)

app = modal.App("housetour-reconstruct")

# Web endpoint secret. The Node worker must send this in the X-Housetour-Key
# header. Set MODAL_WEBHOOK_SECRET (and share the value with the web app env).
secret_env = modal.Secret.from_name("housetour-hook")


@app.function(
    image=cuda_image,
    gpu="any",                      # any available GPU (A10G/L4/A100...)
    secrets=[secret_env],
    timeout=60,                     # probe is short; engines use longer timeouts
    max_containers=1,
)
@modal.fastapi_endpoint(method="POST")
def gpu_probe(payload: dict):
    """Lightweight GPU/CUDA sanity check. Returns device info.

    Body: {"key": "<secret>", "echo": "anything"}  ->  echoed back with GPU diagnostics.
    """
    import torch

    key = payload.get("key") if isinstance(payload, dict) else None
    expected = os.environ.get("MODAL_WEBHOOK_SECRET")
    if expected and key != expected:
        from fastapi import Response
        # Report only lengths — never leak the secret value.
        return Response(
            f"unauthorized (expected_len={len(expected)} provided_len={len(key or '')})",
            status_code=401,
        )

    info = {
        "cuda_available": torch.cuda.is_available(),
        "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "device_name": (
            torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        ),
        "cuda_version": torch.version.cuda,
        "torch_version": torch.__version__,
        "echo": payload.get("echo") if isinstance(payload, dict) else None,
    }
    return info


# --------------------------------------------------------------------------
# Shared helpers: frame download, object storage, callbacks.
# --------------------------------------------------------------------------
import io
import json
import tarfile
import zipfile
import urllib.request

def _s3_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY"),
        region_name=os.environ.get("S3_REGION"),
    )


def download_frames(frames_url: str, dest: str) -> int:
    """Download a ZIP/tar of capture frames to `dest`. Returns file count."""
    import os

    os.makedirs(dest, exist_ok=True)
    req = urllib.request.Request(frames_url, headers={"User-Agent": "housetour"})
    data = urllib.request.urlopen(req, timeout=600).read()
    buf = io.BytesIO(data)
    if zipfile.is_zipfile(buf):
        with zipfile.ZipFile(buf) as z:
            z.extractall(dest)
    else:
        buf.seek(0)
        with tarfile.open(fileobj=buf) as t:
            t.extractall(dest)
    return len(
        [f for f in os.listdir(dest) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    )


def upload_file(local_path: str, key: str) -> str:
    """Upload a local file to object storage; return its public URL."""
    bucket = os.environ["S3_BUCKET"]
    public = os.environ["S3_PUBLIC_URL"].rstrip("/")
    _s3_client().upload_file(local_path, bucket, key)
    return f"{public}/{key}"


def notify_callback(callback_url: str | None, payload: dict):
    if not callback_url:
        return
    try:
        req = urllib.request.Request(
            callback_url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=30)
    except Exception as e:  # callback is best-effort
        print("callback failed:", e)


# --------------------------------------------------------------------------
# Engine A: COLMAP dense reconstruction -> textured/solid GLB.
# --------------------------------------------------------------------------
@app.function(
    image=cuda_image,
    gpu="any",
    secrets=[modal.Secret.from_name("housetour-hook"), modal.Secret.from_name("housetour-s3")],
    timeout=1800,
    max_containers=2,
)
@modal.fastapi_endpoint(method="POST")
def colmap_dense_mesh(payload: dict):
    import os
    import subprocess

    key = payload.get("key")
    expected = os.environ.get("MODAL_WEBHOOK_SECRET")
    if expected and key != expected:
        from fastapi import Response
        return Response("unauthorized", status_code=401)

    job_id = payload["jobId"]
    frames_url = payload.get("framesUrl") or ""
    frames_base64 = payload.get("framesBase64")  # fallback: inline base64 JPGs
    callback_url = payload.get("callbackUrl")
    tour_id = payload.get("tourId", "unknown")
    base = f"orgs/{payload.get('orgId','org')}/tours/{tour_id}/derived/{job_id}"

    work = f"/tmp/colmap_{job_id}"
    os.system(f"rm -rf {work} && mkdir -p {work}/images")
    notify_callback(callback_url, {"stage": "download", "status": "running"})

    # Accept frames inline (base64 array) when frames_url is unreachable
    import base64 as b64
    if frames_base64 and isinstance(frames_base64, list) and len(frames_base64) >= 2:
        for i, b in enumerate(frames_base64):
            raw = b64.b64decode(b)
            with open(f"{work}/images/frame_{i:04d}.jpg", "wb") as fh:
                fh.write(raw)
        n = len(frames_base64)
    else:
        n = download_frames(frames_url, f"{work}/images")
    if n < 2:
        return {"ok": False, "error": "need >=2 frames", "frames": n}

    def run_colmap(args):
        env = dict(os.environ, QT_QPA_PLATFORM="offscreen")
        r = subprocess.run(
            ["xvfb-run", "-a", "-s", "-screen 0 1024x768x24"] + ["colmap"] + args,
            cwd=work, capture_output=True, text=True, env=env,
        )
        if r.returncode != 0:
            raise RuntimeError(f"colmap {' '.join(args[:1])} failed: {r.stderr[:400]}")
        return r.stdout

    try:
        notify_callback(callback_url, {"stage": "features", "status": "running"})
        run_colmap(["feature_extractor", "--database_path", f"{work}/db.db",
                    "--image_path", f"{work}/images", "--ImageReader.single_camera", "1",
                    "--SiftExtraction.use_gpu", "0"])
        matcher = "sequential_matcher" if n >= 12 else "exhaustive_matcher"
        run_colmap([matcher, "--database_path", f"{work}/db.db",
                    "--SiftMatching.use_gpu", "0"])
        notify_callback(callback_url, {"stage": "mapper", "status": "running"})
        os.makedirs(f"{work}/sparse", exist_ok=True)
        run_colmap(["mapper", "--database_path", f"{work}/db.db",
                    "--image_path", f"{work}/images", "--output_path", f"{work}/sparse"])
        if not os.path.exists(f"{work}/sparse/0"):
            return {"ok": False, "error": "mapping failed (insufficient overlap?)"}
        notify_callback(callback_url, {"stage": "dense", "status": "running"})
        run_colmap(["image_undistorter", "--image_path", f"{work}/images",
                    "--input_path", f"{work}/sparse/0", "--output_path", f"{work}/dense",
                    "--output_type", "COLMAP"])
        run_colmap(["patch_match_stereo", "--workspace_path", f"{work}/dense",
                    "--workspace_format", "COLMAP", "--PatchMatchStereo.geom_consistency", "true"])
        run_colmap(["stereo_fusion", "--workspace_path", f"{work}/dense",
                    "--output_path", f"{work}/fused.ply"])
        notify_callback(callback_url, {"stage": "mesh", "status": "running"})
        run_colmap(["poisson_mesher", "--input_path", f"{work}/fused.ply",
                    "--output_path", f"{work}/mesh.ply"])
        # Export COLMAP mesh to PLY (already PLY) and build a GLB via open3d.
        import open3d as o3d
        mesh = o3d.io.read_triangle_mesh(f"{work}/mesh.ply")
        mesh.compute_vertex_normals()
        glb_path = f"{work}/navigation-proxy.glb"
        o3d.io.write_triangle_mesh(glb_path, mesh)
        notify_callback(callback_url, {"stage": "upload", "status": "running"})
        mesh_key = f"{base}/navigation-proxy.glb"
        mesh_url = upload_file(glb_path, mesh_key)
        notify_callback(callback_url, {"stage": "done", "status": "succeeded",
                                       "meshUrl": mesh_url, "frames": n})
        return {"ok": True, "meshUrl": mesh_url, "frames": n, "vertices": len(mesh.vertices)}
    except Exception as e:
        notify_callback(callback_url, {"stage": "failed", "status": "error", "error": str(e)})
        return {"ok": False, "error": str(e)}


# --------------------------------------------------------------------------
# Engine B: 3D Gaussian Splatting -> .ply (and optional .splat).
# --------------------------------------------------------------------------
splat_image = cuda_image.pip_install("gsplat==0.1.7", "tqdm", "pillow")


@app.function(
    image=splat_image,
    gpu="a10g",                      # splat training benefits from more VRAM
    secrets=[modal.Secret.from_name("housetour-hook"), modal.Secret.from_name("housetour-s3")],
    timeout=3600,
    max_containers=2,
)
@modal.fastapi_endpoint(method="POST")
def train_gaussian_splat(payload: dict):
    import os
    import subprocess

    key = payload.get("key")
    expected = os.environ.get("MODAL_WEBHOOK_SECRET")
    if expected and key != expected:
        from fastapi import Response
        return Response("unauthorized", status_code=401)

    job_id = payload["jobId"]
    frames_url = payload.get("framesUrl") or ""
    frames_base64 = payload.get("framesBase64")
    callback_url = payload.get("callbackUrl")
    tour_id = payload.get("tourId", "unknown")
    base = f"orgs/{payload.get('orgId','org')}/tours/{tour_id}/derived/{job_id}"

    work = f"/tmp/splat_{job_id}"
    os.system(f"rm -rf {work} && mkdir -p {work}/images")
    notify_callback(callback_url, {"stage": "download", "status": "running"})

    import base64 as b64
    if frames_base64 and isinstance(frames_base64, list) and len(frames_base64) >= 2:
        for i, b in enumerate(frames_base64):
            raw = b64.b64decode(b)
            with open(f"{work}/images/frame_{i:04d}.jpg", "wb") as fh:
                fh.write(raw)
        n = len(frames_base64)
    else:
        n = download_frames(frames_url, f"{work}/images")
    if n < 2:
        return {"ok": False, "error": "need >=2 frames", "frames": n}

    # Use nerfstudio-style colmap + gsplat training. gsplat ships a training
    # example; we run COLMAP (already in image) for poses then gsplat.
    try:
        env_offscreen = dict(os.environ, QT_QPA_PLATFORM="offscreen")
        notify_callback(callback_url, {"stage": "features", "status": "running"})
        subprocess.run(["xvfb-run", "-a", "colmap", "feature_extractor", "--database_path", f"{work}/db.db",
                        "--image_path", f"{work}/images", "--ImageReader.single_camera", "1",
                        "--SiftExtraction.use_gpu", "0"],
                       cwd=work, check=True, capture_output=True, env=env_offscreen)
        matcher = "sequential_matcher" if n >= 12 else "exhaustive_matcher"
        subprocess.run(["xvfb-run", "-a", "colmap", matcher, "--database_path", f"{work}/db.db",
                        "--SiftMatching.use_gpu", "0"],
                       cwd=work, check=True, capture_output=True, env=env_offscreen)
        os.makedirs(f"{work}/sparse", exist_ok=True)
        notify_callback(callback_url, {"stage": "mapper", "status": "running"})
        subprocess.run(["xvfb-run", "-a", "colmap", "mapper", "--database_path", f"{work}/db.db",
                        "--image_path", f"{work}/images", "--output_path", f"{work}/sparse"],
                       cwd=work, check=True, capture_output=True, env=env_offscreen)
        if not os.path.exists(f"{work}/sparse/0"):
            return {"ok": False, "error": "mapping failed (insufficient overlap?)"}
        # Convert COLMAP model to transforms.json (nerfstudio) for gsplat.
        notify_callback(callback_url, {"stage": "train", "status": "running"})
        # gsplat provides `examples/simple_train.py`; invoke via python -m.
        env = dict(os.environ)
        r = subprocess.run(
            ["python", "-m", "gsplat.tools.simple_train",
             "--data", f"{work}/sparse/0", "--output_dir", f"{work}/ckpt"],
            cwd=work, env=env, capture_output=True, text=True,
        )
        if r.returncode != 0:
            raise RuntimeError(f"gsplat train failed: {r.stderr[:500]}")
        # Export trained model to .ply (3DGS format) for the web viewer.
        ply_out = f"{work}/splat.ply"
        r2 = subprocess.run(
            ["python", "-m", "gsplat.tools.export", "--checkpoint", f"{work}/ckpt",
             "--output", ply_out],
            cwd=work, capture_output=True, text=True,
        )
        if r2.returncode != 0 or not os.path.exists(ply_out):
            raise RuntimeError(f"gsplat export failed: {r2.stderr[:400]}")
        notify_callback(callback_url, {"stage": "upload", "status": "running"})
        splat_key = f"{base}/gaussian-splat.ply"
        splat_url = upload_file(ply_out, splat_key)
        notify_callback(callback_url, {"stage": "done", "status": "succeeded",
                                       "splatUrl": splat_url, "frames": n})
        return {"ok": True, "splatUrl": splat_url, "frames": n}
    except Exception as e:
        notify_callback(callback_url, {"stage": "failed", "status": "error", "error": str(e)})
        return {"ok": False, "error": str(e)}
