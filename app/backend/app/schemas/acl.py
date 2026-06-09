import uuid

from pydantic import BaseModel, ConfigDict

from app.models.document_permission import PermissionLevel


class PermissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    user_name: str
    level: PermissionLevel


class PermissionUpsert(BaseModel):
    level: PermissionLevel
