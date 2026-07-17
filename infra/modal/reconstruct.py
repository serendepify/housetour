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
    .apt_install("wget", "git")
    .pip_install(
        "torch==2.2.2",
        "numpy==1.26.4",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install("fastapi[standard]")
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
# Phase 2 engines (colmap_dense_mesh, train_gaussian_splat) are added below.
# They reuse `cuda_image` (extended with COLMAP + gsplat) and the same
# web-endpoint + callback pattern as gpu_probe.
# --------------------------------------------------------------------------
