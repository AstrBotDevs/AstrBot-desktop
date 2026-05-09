import json
import sys


result = {"ok": False, "missing": ["discord"], "file": None, "version": None}
try:
    import discord
    result["file"] = getattr(discord, "__file__", None)
    result["version"] = getattr(discord, "__version__", None)

    if not hasattr(discord, "Bot"):
        result["missing"] = ["discord.Bot"]
    else:
        result["ok"] = True
        result["missing"] = []
except ImportError as e:
    result["error"] = f"{type(e).__name__}: {e}"
except Exception as e:
    result["error"] = f"{type(e).__name__}: {e}"

# Prefix is passed as argv[1] by the caller so it is defined in one place.
# Default allows running the script standalone for quick checks.
prefix = sys.argv[1] if len(sys.argv) > 1 else "ASTRBOT_VALIDATE_DISCORD_JSON:"
print(f"{prefix}{json.dumps(result)}")
sys.exit(0 if result["ok"] else 1)
