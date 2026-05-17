import sqlite3
import os

db_path = r"c:\Users\DotchCloud\Downloads\thesis ewan\fire-emergency-response-main\fire-ml-backend\fire_response.db"
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user")
    users = cursor.fetchall()
    for user in users:
        print(user)
    conn.close()
else:
    print(f"Database not found at {db_path}")
