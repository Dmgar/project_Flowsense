import os
import secrets
from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-FlowSense-Key", auto_error=False)

def get_expected_key() -> str:
    return os.getenv("FLOWSENSE_API_KEY", "").strip()

async def require_operator_key(api_key: str = Security(api_key_header)):
    """
    Validates X-FlowSense-Key header using constant-time comparison when FLOWSENSE_API_KEY is configured.
    Protects administrative and graph mutation endpoints against anonymous tampering in production.
    """
    expected = get_expected_key()
    if expected:
        if not api_key or not secrets.compare_digest(api_key, expected):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Restricted endpoint: valid X-FlowSense-Key header required."
            )
