from typing import Literal

from pydantic import BaseModel, field_validator


class DeviceAuthRequest(BaseModel):
    device_uuid: str

    @field_validator("device_uuid")
    @classmethod
    def validate_device_uuid(cls, value: str) -> str:
        normalized = value.strip()
        if not 1 <= len(normalized) <= 128:
            raise ValueError("device_uuid must contain 1 to 128 characters")
        return normalized


class DeviceAuthResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    is_new_user: bool
