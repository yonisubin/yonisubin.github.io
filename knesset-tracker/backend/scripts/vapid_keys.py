"""Print a new VAPID key pair for Web Push (set them as VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY)."""
from app.push import generate_vapid_keys

if __name__ == "__main__":
    private, public = generate_vapid_keys()
    print(f"VAPID_PRIVATE_KEY={private}\nVAPID_PUBLIC_KEY={public}")
