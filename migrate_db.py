import sqlite3
import os

db_path = r"c:\Users\DotchCloud\Downloads\thesis ewan\fire-emergency-response-main\fire-ml-backend\fire_response.db"

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if columns already exist
    cursor.execute("PRAGMA table_info(user)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if 'first_name' not in columns:
        print("Adding first_name column...")
        cursor.execute("ALTER TABLE user ADD COLUMN first_name TEXT")
    
    if 'last_name' not in columns:
        print("Adding last_name column...")
        cursor.execute("ALTER TABLE user ADD COLUMN last_name TEXT")
        
    conn.commit()
    conn.close()
    print("Database migration completed.")
else:
    print(f"Database not found at {db_path}")
