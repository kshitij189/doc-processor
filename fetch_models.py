import requests
import json

response = requests.get("https://openrouter.ai/api/v1/models")
data = response.json()
for model in data.get("data", []):
    if model["id"].startswith("google/gemini"):
        print(model["id"])
