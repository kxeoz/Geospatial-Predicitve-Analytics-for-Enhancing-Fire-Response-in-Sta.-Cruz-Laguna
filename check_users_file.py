import sqlite3
import os

db_path = r"c:\Users\DotchCloud\Downloads\thesis ewan\fire-emergency-response-main\fire-ml-backend\fire_response.db"
output_path = r"c:\Users\DotchCloud\Downloads\thesis ewan\fire-emergency-response-main\db_output.txt"

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user")
    users = cursor.fetchall()
    with open(output_path, 'w') as f:
        for user in users:
            f.write(str(user) + '\n')
    conn.close()
else:
    with open(output_path, 'w') as f:
        f.write(f"Database not found at {db_path}")
