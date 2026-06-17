"""Provision (or update) the admin account.

Usage:
    python -m app.scripts.create_admin <email> <password> "<Full Name>"
"""

import sys

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import User, UserRole


def main() -> None:
    if len(sys.argv) < 4:
        print('Usage: python -m app.scripts.create_admin <email> <password> "<Full Name>"')
        raise SystemExit(1)

    email, password, full_name = sys.argv[1], sys.argv[2], sys.argv[3]
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.role = UserRole.admin
            user.password_hash = hash_password(password)
            user.full_name = full_name
            user.is_active = True
            action = "updated"
        else:
            user = User(
                email=email,
                password_hash=hash_password(password),
                full_name=full_name,
                role=UserRole.admin,
            )
            db.add(user)
            action = "created"
        db.commit()
        print(f"Admin {action}: {email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
