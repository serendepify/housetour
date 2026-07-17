# HouseTour Reconstruction — Resource Constraints & Architecture

This document explains what it takes to produce *appreciable* real 3D from
HouseTour capture, the two reconstruction engines we support, and exactly what
hardware/cost/effort each requires. It is written to be read by an engineer
deciding where to spend money and time.

---

## TL;DR

| | COLMAP dense mesh | Gaussian Splatting | Software proxy (fallback) |
|---|---|---|---|
| Output | Textured/solid `.glb` mesh | Photoreal `.ply` splat | Textured room `.glb` |
| Walkable | Yes (geometry) | Yes (camera path) | Yes (geometry) |
| Photoreal | Partial (Poisson mesh) | **Yes** | No (layout proxy) |
| GPU needed | CUDA, any | CUDA, 12-24GB VRAM | **No** |
| Per-tour cost (Modal) | ~$0.30-0.90 | ~$0.60-1.80 | $0 |
| Training time | 5-25 min / room | 20-45 min / scene | seconds |
| Hardware at you | None (Modal) | None (Modal) | CPU only |

The product **always works**: with no GPU configured it ships the software
room mesh. With Modal credits + `MODAL_WEBHOOK_URL` set, real reconstruction
runs on demand and scale-to-zero.

---

## Why Modal

The Node/BullMQ workers run on **CPU-only** compute (Vercel/Railway/Containers).
Photogrammetry and splatting need **NVIDIA CUDA GPUs**, which are expensive to
keep warm and impossible to install on Apple Silicon / most PaaS.

Modal solves both:
- Per-second GPU billing, **scale-to-zero** (pay only while a job runs).
- Pre-built CUDA images (we pin `nvidia/cuda:12.1.1-runtime`).
- The worker stays GPU-free: it POSTs frames to a Modal web endpoint, Modal
  spins up a GPU container, runs the engine, uploads the result to object
  storage, and reports back via `/api/jobs/[jobId]/modal-callback`.

Endpoints (deployed in `infra/modal/reconstruct.py`):
- `...-colmap-dense-mesh.modal.run` — SfM → dense → Poisson → GLB
- `...-train-gaussian-splat.modal.run` — COLMAP poses → 3DGS → `.ply`

### Proven working
`gpu_probe` returned `{"cuda_available":true,"device_name":"NVIDIA L4",
"cuda_version":"12.1"}` — a real GPU reached from the Node worker.

---

## Engine A — COLMAP dense mesh (real geometry)

Pipeline (all in Modal):
1. `feature_extractor` (SIFT) on every frame
2. `sequential_matcher` (≥12 frames) or `exhaustive_matcher`
3. `mapper` → sparse point cloud + camera poses
4. `image_undistorter` → undistorted images + COLMAP dense workspace
5. `patch_match_stereo` (dense depth, geometric consistency on)
6. `stereo_fusion` → fused `.ply`
7. `poisson_mesher` → watertight mesh
8. open3d → export `navigation-proxy.glb`

**Constraints**
- Input: **40-150 overlapping frames per room** (phone video → frames works).
  Overlap >60%, no motion blur, consistent exposure. Garbage in → holes.
- GPU: any CUDA GPU (L4/A10G/A100). Dense stereo is the slow part.
- VRAM: 8GB minimum; 16GB+ for whole-home in one shot.
- Time: ~5-25 min per room on L4.
- Output is a *meshed* room you can free-walk (reuses existing
  `MeshWalkController` collision). Photoreal-ish but smoothed (Poisson).

## Engine B — Gaussian Splatting (photoreal)

Pipeline (Modal, `gpu="a10g"`):
1. COLMAP poses (steps 1-3 above)
2. `gsplat` training (3DGS) on the undistorted frames
3. Export trained model to `.ply` (3DGS format)
4. Web viewer (`SplatViewer.tsx`) renders it with
   `@mkkellogg/gaussian-splats-3d`.

**Constraints**
- Input: same as COLMAP, but **more frames = better**. 60-200 ideal.
- GPU: **A10G/L4 (24GB recommended)**. 12GB works for small scenes.
- VRAM is the hard limit — this is why we pin `gpu="a10g"`.
- Time: 20-45 min training per scene.
- Output: **photoreal**, best "wow" for a real-estate tour, but NOT
  metric geometry (no collision off the splat itself — camera path only).

---

## Object storage

Reconstruction reads frames and writes results to the **same** object storage
the app uses (MinIO locally, R2/S3 in prod). The Modal function holds the
`housetour-s3` secret so it can upload directly. The worker never streams
large binaries — it uploads a frames ZIP and Modal pulls it.

Required env (web + worker):
```
MODAL_WEBHOOK_URL=https://<workspace>--housetour-reconstruct-gpu-probe.modal.run
MODAL_WEBHOOK_SECRET=<from modal secret housetour-hook>
RECON_ENGINE=colmap|splat        # default colmap
APP_BASE_URL=https://your-app      # for the callback URL
```

---

## Effort / roadmap

Done:
- [x] Modal app + proven CUDA loop
- [x] COLMAP + Gaussian Splatting engines deployed
- [x] Worker GPU path with CPU fallback
- [x] `SPLAT` scene kind + `SPLAT_PLY` asset kind
- [x] Splat viewer component

Known gaps before "production real 3D":
- [ ] Real capture frames in MinIO (currently down locally; use `S3_BACKEND=fs`
      or bring MinIO up). The 52 MULTI_VIEW assets in DB reference MinIO keys.
- [ ] Texture the COLMAP mesh properly (mvs-texturing) — currently exports a
      solid Poisson mesh via open3d; photoreal texturing is a follow-up.
- [ ] Splat collision / room connectivity (today splats are camera-path only).
- [ ] Capture-guidance UX so inputs meet the overlap bar (output quality is
      dominated by capture quality).
- [ ] WebXR support for the splat viewer (meshes already support VR).

## Cost model (Modal, per tour)

| Tour size | Engine | GPU | Approx. cost |
|---|---|---|---|
| 1 room (~80 frames) | colmap | L4 | $0.40 |
| 1 room (~120 frames) | splat | A10G | $1.20 |
| Whole home (~400 frames) | splat | A10G | $3-5 |
| Whole home, batched | colmap | A10G | $1.50 |

Scale-to-zero means idle cost is **$0**. The modal-cli venv (`.venv-modal`)
and `.modal_secret` are gitignored.
