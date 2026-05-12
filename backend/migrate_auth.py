import sqlalchemy as sa
from sqlalchemy import text
import os

# Database URL from environment or default
DATABASE_URL = os.getenv(
    "DATABASE_URL_SYNC", 
    "postgresql://postgres:postgres@db:5432/docprocessor"
)

def run_migration():
    engine = sa.create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print(f"Connecting to {DATABASE_URL}...")
        
        # 1. Create users table if not exists
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255),
                hashed_password VARCHAR(512) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))
        conn.commit()
        print("Confirmed 'users' table exists.")

        # 2. Add user_id to documents if not exists
        try:
            conn.execute(text("ALTER TABLE documents ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;"))
            conn.commit()
            print("Added 'user_id' column to 'documents' table.")
        except Exception as e:
            print(f"Skipping documents.user_id: {e}")
            conn.rollback()

        # 3. Add user_id to chat_sessions if not exists
        try:
            conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;"))
            conn.commit()
            print("Added 'user_id' column to 'chat_sessions' table.")
        except Exception as e:
            print(f"Skipping chat_sessions.user_id: {e}")
            conn.rollback()

        print("Migration complete!")

if __name__ == "__main__":
    run_migration()
