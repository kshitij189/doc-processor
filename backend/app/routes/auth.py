"""
Auth API routes: register, login, and get current user profile.
On first registration, auto-assigns all orphaned documents and chat sessions.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Document, ChatSession
from app.schemas import RegisterRequest, LoginRequest, LoginResponse, UserResponse
from app.services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", response_model=LoginResponse, status_code=201)
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user account."""
    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == request.email))
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    # Check if this is the very first user
    user_count = await db.execute(select(User.id).limit(1))
    is_first_user = user_count.scalars().first() is None

    # Create user
    user = User(
        id=uuid.uuid4(),
        email=request.email,
        name=request.name,
        hashed_password=hash_password(request.password),
    )
    db.add(user)
    await db.flush()

    # Auto-assign orphaned documents and chat sessions to the first user
    if is_first_user:
        await db.execute(
            update(Document).where(Document.user_id.is_(None)).values(user_id=user.id)
        )
        await db.execute(
            update(ChatSession)
            .where(ChatSession.user_id.is_(None))
            .values(user_id=user.id)
        )

    await db.commit()
    await db.refresh(user)

    token = create_access_token(str(user.id), user.email)
    return LoginResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate and return a JWT token."""
    result = await db.execute(select(User).where(User.email == request.email))
    user = result.scalars().first()

    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(str(user.id), user.email)
    return LoginResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return UserResponse.model_validate(current_user)
