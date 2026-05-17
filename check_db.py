import sqlite3
import os

db_path = r"c:\Users\DotchCloud\Downloads\thesis ewan\fire-emergency-response-main\fire-ml-backend\fire_response.db"
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(user)")
    columns = cursor.fetchall()
    for col in columns:
        print(col)
    conn.close()
else:
    print(f"Database not found at {db_path}")
