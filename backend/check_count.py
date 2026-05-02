
import asyncio
from app.database import async_session_factory
from app.models import Document
from sqlalchemy import select, func

async def check():
    async with async_session_factory() as session:
        res = await session.execute(select(func.count(Document.id)))
        print(f"Total documents: {res.scalar()}")

if __name__ == "__main__":
    asyncio.run(check())
