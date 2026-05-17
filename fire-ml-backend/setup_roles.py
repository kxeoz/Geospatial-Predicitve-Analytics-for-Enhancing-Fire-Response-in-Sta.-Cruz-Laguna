
import os
import sys
from flask_sqlalchemy import SQLAlchemy
from flask import Flask

# Add the parent directory to sys.path to find app.py
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)

from app import db, User, app

def setup_users():
    with app.app_context():
        # Create tables if they don't exist (including the new role column)
        db.create_all()
        
        # 1. Update existing admin if exists, or create it
        admin_email = 'admin@bfp.gov.ph'
        admin_user = User.query.filter_by(username=admin_email).first()
        if not admin_user:
            print(f"Creating admin user: {admin_email}")
            admin_user = User(username=admin_email, password='password123', role='admin')
            db.session.add(admin_user)
        else:
            print(f"Updating admin user role: {admin_email}")
            admin_user.role = 'admin'
        
        # 2. Create the new user account
        user_email = 'user@bfp.gov.ph'
        regular_user = User.query.filter_by(username=user_email).first()
        if not regular_user:
            print(f"Creating regular user: {user_email}")
            regular_user = User(username=user_email, password='user000', role='user')
            db.session.add(regular_user)
        else:
            print(f"Updating regular user: {user_email}")
            regular_user.password = 'user000'
            regular_user.role = 'user'
            
        db.session.commit()
        print("Successfully updated database with new user accounts.")

if __name__ == "__main__":
    setup_users()
