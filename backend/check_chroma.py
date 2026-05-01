
import chromadb
from app.core.config import settings

def check_chroma():
    client = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    collections = client.list_collections()
    print(f"Total Collections: {len(collections)}")
    total_chunks = 0
    for col in collections:
        count = col.count()
        print(f"Collection: {col.name}, Chunks: {count}")
        total_chunks += count
    print(f"Total Chunks: {total_chunks}")

if __name__ == "__main__":
    try:
        check_chroma()
    except Exception as e:
        print(f"Error: {e}")
