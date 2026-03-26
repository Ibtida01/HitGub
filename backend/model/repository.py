from typing import Literal, Optional

from pydantic import BaseModel, Field


class CreateRepositoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    visibility: Literal["public", "private"] = "public"
    default_branch: str = Field(default="main", min_length=1, max_length=100)
    license_type: Optional[str] = None
    initialize_with_readme: bool = True


class UpdateRepositoryRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    visibility: Optional[Literal["public", "private"]] = None
    default_branch: Optional[str] = Field(default=None, min_length=1, max_length=100)
    license_type: Optional[str] = None
    has_readme: Optional[bool] = None


class CreateBranchRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UpdateBranchProtectionRequest(BaseModel):
    is_protected: bool
