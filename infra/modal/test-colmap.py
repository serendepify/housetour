"""
Direct Modal COLMAP test — bypasses worker/storage, sends 25 frames inline.
Run: . .venv-modal/bin/activate && python infra/modal/test-colmap.py
"""
import os, sys, json, base64, urllib.request, time

TOKEN = open(".modal_secret").read().strip()
FRAMES_DIR = "apps/web/public/test-frames"
ENDPOINT = "https://createdliving1000--housetour-reconstruct-colmap-dense-mesh.modal.run"

# Read and encode frames
frames = []
for fname in sorted(os.listdir(FRAMES_DIR)):
    if fname.endswith(".jpg"):
        data = open(os.path.join(FRAMES_DIR, fname), "rb").read()
        frames.append(base64.b64encode(data).decode())
print(f"Encoded {len(frames)} frames ({sum(len(b) for b in frames) // 700:,.0f}KB base64)")

payload = {
    "key": TOKEN,
    "jobId": "test-colmap-001",
    "tourId": "test",
    "orgId": "test",
    "framesBase64": frames,
    "engine": "colmap",
}

print(f"POSTing to {ENDPOINT} ...")
req = urllib.request.Request(
    ENDPOINT,
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
start = time.time()
try:
    resp = urllib.request.urlopen(req, timeout=1800)
    raw = resp.read()
    result = json.loads(raw)
    elapsed = time.time() - start
    print(f"Response ({elapsed:.0f}s):")
    print(json.dumps(result, indent=2))
    if result.get("ok"):
        print(f"\n✓ SUCCESS — mesh at: {result.get('meshUrl')}")
    else:
        print(f"\n✗ FAILED — {result.get('error')}")
except Exception as e:
    elapsed = time.time() - start
    print(f"Error after {elapsed:.0f}s: {e}")
    if hasattr(e, "read"):
        print(e.read().decode()[:500])
