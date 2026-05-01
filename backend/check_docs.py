import asyncio
import os
import sys

# Add the current directory to sys.path to import app
sys.path.append(os.getcwd())

from app.database import async_session_factory
from app.models import Document
from sqlalchemy.future import select

async def check_docs():
    async with async_session_factory() as session:
        result = await session.execute(select(Document))
        docs = result.scalars().all()
        print(f"Total documents in database: {len(docs)}")
        for doc in docs:
            print(f"- {doc.filename}: ID={doc.id}, Status={doc.status}, Type={doc.file_type}")

if __name__ == "__main__":
    asyncio.run(check_docs())
