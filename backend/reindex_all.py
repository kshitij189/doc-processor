import os
import sys

# Add the current directory to sys.path to import app
sys.path.append(os.getcwd())

from app.worker.tasks import process_document
from app.worker.tasks import SyncSession
from app.models import Document

def reindex_all():
    session = SyncSession()
    try:
        docs = session.query(Document).all()
        print(f"Triggering re-processing for {len(docs)} documents...")
        for doc in docs:
            print(f"- Dispatching task for {doc.filename} ({doc.id})")
            process_document.delay(str(doc.id))
        print("All tasks dispatched. They will be processed in the background.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        session.close()

if __name__ == "__main__":
    reindex_all()
