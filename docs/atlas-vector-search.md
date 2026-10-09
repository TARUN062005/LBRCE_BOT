# MongoDB Atlas Vector Search

Semantic search works without this index. When `VECTOR_SEARCH_INDEX` is empty, the API embeds chunks with Gemini (if a key is set) and ranks them with cosine similarity in the application. Create an Atlas Search vector index when the chunk collection is large.

1. Open the Atlas cluster used by `MONGODB_URI`.
2. Create a Vector Search index on the `documentchunks` collection.
3. Use the definition below. `numDimensions` must match `GEMINI_EMBEDDING_DIMENSIONS` (768 by default for `gemini-embedding-001`).
4. Set `VECTOR_SEARCH_INDEX` to the index name and restart the API.

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "published" },
    { "type": "filter", "path": "metadata.department" },
    { "type": "filter", "path": "metadata.documentType" },
    { "type": "filter", "path": "metadata.academicYear" }
  ]
}
```

If the aggregation fails, the API logs a warning and uses the cosine fallback. Do not treat a missing index as a successful vector search.
