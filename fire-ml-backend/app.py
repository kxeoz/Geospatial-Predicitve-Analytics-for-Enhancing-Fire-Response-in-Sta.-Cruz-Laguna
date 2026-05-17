# app.py - UPDATED WITH HIGH ACCURACY XGBOOST MODEL
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import mean_absolute_error, r2_score
import joblib
import json
from datetime import datetime, timedelta
import os
import csv
import xgboost as xgb
import warnings
warnings.filterwarnings('ignore')

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))

app = Flask(
    __name__,
    template_folder=ROOT_DIR,
    static_folder=ROOT_DIR,
    static_url_path=''  # serve existing css/js paths without rewriting
)
CORS(app)

# Database Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(SCRIPT_DIR, 'fire_response.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Database Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), default='admin') # 'admin' or 'user'
    first_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100))

class Incident(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    station = db.Column(db.String(100))
    date = db.Column(db.String(50))
    location = db.Column(db.String(255))
    responding_unit = db.Column(db.String(100))
    time_received = db.Column(db.String(50))
    time_dispatched = db.Column(db.String(50))
    time_arrival = db.Column(db.String(50))
    response_time = db.Column(db.Float)
    distance = db.Column(db.Float)
    alarm_status = db.Column(db.String(50))
    type = db.Column(db.String(100))
    injured_civ = db.Column(db.Integer, default=0)
    injured_bfp = db.Column(db.Integer, default=0)
    death_civ = db.Column(db.Integer, default=0)
    death_bfp = db.Column(db.Integer, default=0)
    remarks = db.Column(db.Text)
    temperature = db.Column(db.Float)
    humidity = db.Column(db.Float)
    wind_speed = db.Column(db.Float)
    precipitation = db.Column(db.Float)
    weather = db.Column(db.String(100))
    road_condition = db.Column(db.String(100))
    timestamp = db.Column(db.String(100))
    
    # Extra ML features (derived)
    severity = db.Column(db.String(50))
    total_casualties = db.Column(db.Integer)
    is_false_alarm = db.Column(db.Integer)
    is_rainy = db.Column(db.Integer)
    
    # Soft delete for trash functionality
    is_deleted = db.Column(db.Boolean, default=False, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True)

class Hydrant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(50))
    address = db.Column(db.String(255))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    status = db.Column(db.String(50))
    remarks = db.Column(db.Text)
    is_deleted = db.Column(db.Boolean, default=False, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True)

class HazardRoad(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255))
    coordinates = db.Column(db.JSON) # Store list of [lat, lng]
    severity = db.Column(db.String(50))

class EmergencyContact(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    number = db.Column(db.String(50), nullable=False)
    description = db.Column(db.String(255))
    type = db.Column(db.String(20)) # 'fire', 'police', 'medical', 'other'
    is_deleted = db.Column(db.Boolean, default=False, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True)

# Define CSV columns
CSV_COLUMNS = [
    'STATION', 'DATE_OF_RESPONSE', 'LOCATION', 'RESPONDING_UNIT', 'TIME_RECEIVED',
    'TIME_DISPATCHED', 'TIME_ARRIVAL', 'RESPONSE_TIME_MIN', 'DISTANCE', 'ALARM_STATUS',
    'TIME_LAST_ALARM', 'TYPE_OF_OCCUPANCY', 'INJURED_CIV', 'INJURED_BFP',
    'DEATH_CIV', 'DEATH_BFP', 'REMARKS', 'Temperature_C', 'Humidity_%',
    'Wind_Speed_kmh', 'Precipitation_mm', 'Weather_Condition', 'Road_Condition'
]

# Global variables
fire_analyzer = None
fire_incidents = []
fire_hydrants = []
hazard_roads = []

@app.route('/')
def index():
    """Serve the main dashboard"""
    return render_template('dashboard.html')

@app.route('/login')
def login_page():
    """Serve the login page"""
    return render_template('login.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    """Authenticate admin user"""
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        user = User.query.filter_by(username=username, password=password).first()
        if user:
            return jsonify({
                'success': True, 
                'message': 'Login successful', 
                'redirect': '/',
                'user': {
                    'username': user.username,
                    'role': user.role or 'admin' # Default to admin if role is null
                }
            })
        else:
            return jsonify({'success': False, 'message': 'Invalid credentials'}), 401
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/user/profile', methods=['GET', 'POST'])
def user_profile():
    """Get or update user profile"""
    # 1. Resolve identity: find the user record to act upon
    identity = request.args.get('username')
    if not identity and request.is_json:
        # Prioritize lookup keys that represent the existing record
        identity = request.json.get('current_username') or request.json.get('old_username') or request.json.get('username')
        
    if not identity:
        return jsonify({'success': False, 'message': 'Username required'}), 400
        
    user = User.query.filter_by(username=identity).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found'}), 404
        
    if request.method == 'POST':
        try:
            data = request.json
            new_username = data.get('new_username')
            
            # Check if username is being changed
            if new_username and new_username != user.username:
                # Check if new username already exists in another record
                existing_user = User.query.filter_by(username=new_username).first()
                if existing_user:
                    return jsonify({'success': False, 'message': 'Email already in use'}), 400
                user.username = new_username
            
            # Update other fields
            user.first_name = data.get('first_name', user.first_name)
            user.last_name = data.get('last_name', user.last_name)
            user.role = data.get('role', user.role)
            db.session.commit()
            return jsonify({
                'success': True, 
                'message': 'Profile updated successfully',
                'user': {
                    'username': user.username,
                    'first_name': user.first_name,
                    'last_name': user.last_name,
                    'role': user.role
                }
            })
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'message': str(e)}), 500
            
    return jsonify({
        'success': True,
        'user': {
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'role': user.role
        }
    })

@app.route('/api/user/password', methods=['POST'])
def change_password():
    """Change user password"""
    try:
        data = request.json
        username = data.get('username')
        old_password = data.get('old_password')
        new_password = data.get('new_password')
        
        user = User.query.filter_by(username=username, password=old_password).first()
        if not user:
            return jsonify({'success': False, 'message': 'Invalid current password'}), 401
            
        user.password = new_password
        db.session.commit()
        return jsonify({'success': True, 'message': 'Password changed successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/dashboard.html')
def dashboard_redirect():
    """Redirect dashboard.html to root for consistency"""
    from flask import redirect, url_for
    return redirect(url_for('index'))

# JSON Serialization Helper
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif pd.isna(obj):
            return None
        return super(NumpyEncoder, self).default(obj)

app.json_encoder = NumpyEncoder

def convert_to_native_types(obj):
    """Convert numpy and other non-serializable types to native Python types"""
    if isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float32, np.float64)):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_to_native_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_native_types(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_to_native_types(item) for item in obj)
    else:
        return obj

# Helper functions
def analyze_performance(current_time, expected_time, time_diff, distance):
    """Analyze performance and provide detailed feedback"""
    performance_ratio = current_time / expected_time if expected_time > 0 else 1.0
    if performance_ratio < 0.8:
        status = "excellent"
        message = "🚀 Outstanding performance! Significantly faster than expected."
        color = "green"
    elif performance_ratio < 1.0:
        status = "good"
        message = "✅ Good performance! Faster than average response."
        color = "blue"
    elif performance_ratio < 1.2:
        status = "average"
        message = "⚠️ Average performance. Meets expectations."
        color = "yellow"
    elif performance_ratio < 1.5:
        status = "needs_improvement"
        message = "📊 Below average performance. Room for improvement."
        color = "orange"
    else:
        status = "poor"
        message = "🚨 Significant delay detected. Immediate improvement needed."
        color = "red"
    
    efficiency = current_time / (distance if distance > 0 else 1.0)
    efficiency_rating = "high" if efficiency < 2.0 else "medium" if efficiency < 3.0 else "low"
    
    return {
        'status': status,
        'message': message,
        'color': color,
        'efficiency_rating': efficiency_rating,
        'efficiency_score': round(efficiency, 2),
        'performance_ratio': round(performance_ratio, 2),
        'improvement_opportunity': max(0, time_diff)
    }

def generate_improvement_suggestions_detailed(incident_data, comparison, historical_data):
    """Generate detailed, actionable improvement suggestions matching frontend UI"""
    suggestions = []
    current_time = incident_data.get('response_time', 0)
    expected_time = comparison.get('expected_response_time', current_time)
    time_diff = comparison.get('time_difference', 0)
    distance = incident_data.get('distance', 0)
    
    if time_diff > 5:
        suggestions.append({
            'title': "Reduce Response Time",
            'priority': 'high',
            'description': f"Your response was {time_diff:.1f} minutes slower than predicted for similar incidents.",
            'actionable_steps': [
                "Review dispatch protocols for faster mobilization",
                "Conduct drills focused on rapid turn-out times",
                "Analyze potential bottlenecks in the initial dispatch phase"
            ],
            'expected_impact': "3-5 minute reduction in response time",
            'implementation_difficulty': "Medium",
            'time_to_implement': "2-4 weeks"
        })
    
    if distance > 0:
        efficiency = current_time / distance
        if efficiency > 3.0:
            suggestions.append({
                'title': "Improve Route Efficiency",
                'priority': 'medium',
                'description': f"Travel efficiency of {efficiency:.1f} min/km is below optimal levels.",
                'actionable_steps': [
                    "Utilize real-time traffic navigation tools",
                    "Study alternative routes for high-traffic areas",
                    "Coordinate with local traffic management for emergency priority"
                ],
                'expected_impact': "Improved travel speed by 15-20%",
                'implementation_difficulty': "Low",
                'time_to_implement': "Immediate"
            })
    
    weather = str(incident_data.get('weather', '')).lower()
    if any(term in weather for term in ['rain', 'storm', 'typhoon', 'heavy']) and time_diff > 2:
        suggestions.append({
            'title': "Enhance Weather Response",
            'priority': 'medium',
            'description': "Adverse weather conditions significantly impacted your response time.",
            'actionable_steps': [
                "Equip units with advanced wet-weather driving training",
                "Pre-position units in high-risk areas during storm warnings",
                "Maintain specialized equipment for flood-prone zone access"
            ],
            'expected_impact': "Better consistency across all weather types",
            'implementation_difficulty': "Medium",
            'time_to_implement': "1-2 months"
        })
        
    if current_time > 15:
        suggestions.append({
            'title': "Optimize Equipment Deployment",
            'priority': 'high',
            'description': "Long response times indicate potential equipment optimization opportunities.",
            'actionable_steps': [
                "Review heavy equipment placement across stations",
                "Consider smaller, more agile response vehicles for congested areas",
                "Audit equipment readiness procedures"
            ],
            'expected_impact': "Faster arrival for specialized units",
            'implementation_difficulty': "High",
            'time_to_implement': "3-6 months"
        })
        
    return suggestions

def generate_training_recommendations_detailed(historical_data):
    """Generate detailed training recommendations matching frontend UI"""
    recommendations = []
    
    if len(historical_data) < 20:
        recommendations.append({
            'title': "Expand Data Collection",
            'priority': 'high',
            'description': f"Currently have {len(historical_data)} incidents. More data is needed for reliable AI analysis.",
            'actions': [
                "Ensure all historical records are digitized",
                "Maintain consistent reporting for every response",
                "Include more environmental variables in reports"
            ],
            'benefits': "Increased prediction accuracy and better performance insights"
        })
    
    df = pd.DataFrame(historical_data)
    if 'response_time' in df.columns and len(df) > 1:
        response_std = df['response_time'].std()
        if response_std > 5:
            recommendations.append({
                'title': "Improve Response Consistency",
                'priority': 'medium',
                'description': "High variability in response times indicates inconsistent performance.",
                'actions': [
                    "Standardize turnout procedures across all shifts",
                    "Conduct cross-shift performance review meetings",
                    "Implement performance benchmarking for common incident types"
                ],
                'benefits': "More predictable and reliable emergency response"
            })
            
    return recommendations

def identify_success_factors(incident_data, comparison):
    """Identify what worked well in the response matching frontend UI"""
    success_factors = []
    time_diff = comparison.get('time_difference', 0)
    
    if time_diff < -1:
        success_factors.append({
            'message': f"Exceptional Response Speed: {abs(time_diff):.1f} minutes faster than predicted!",
            'best_practices': [
                "Maintain high levels of personnel readiness",
                "Effective use of navigation and route planning",
                "Rapid mobilization during the dispatch phase"
            ]
        })
    
    distance = incident_data.get('distance', 0)
    current_time = incident_data.get('response_time', 0)
    if distance > 0 and current_time > 0:
        efficiency = current_time / distance
        if efficiency < 2.0:
            success_factors.append({
                'message': f"Superior Route Efficiency: {efficiency:.1f} min/km achieved",
                'best_practices': [
                    "Selection of optimal pathing to the incident",
                    "Excellent driver performance and situational awareness",
                    "Minimal delays from traffic or road conditions"
                ]
            })
            
    return success_factors

def generate_comprehensive_feedback(incident_data, comparison, historical_data):
    """Generate comprehensive feedback matching frontend expectations exactly"""
    current_time = incident_data.get('response_time', 0)
    expected_time = comparison.get('expected_response_time', current_time)
    time_diff = comparison.get('time_difference', 0)
    
    performance_analysis = analyze_performance(current_time, expected_time, time_diff, incident_data.get('distance', 1.0))
    improvement_suggestions = generate_improvement_suggestions_detailed(incident_data, comparison, historical_data)
    training_recommendations = generate_training_recommendations_detailed(historical_data)
    success_factors = identify_success_factors(incident_data, comparison)
    
    model_accuracy = 0
    if fire_analyzer and fire_analyzer._baseline_performance:
        model_accuracy = fire_analyzer._baseline_performance.get('r2', 0)
        
    return {
        'performance_overview': {
            'avg_response_time': sum(inc.get('response_time', 0) for inc in historical_data) / len(historical_data) if historical_data else 0,
            'model_accuracy': model_accuracy,
            'total_incidents': len(historical_data)
        },
        'comparison_metrics': {
            'current_response_time': round(current_time, 2),
            'expected_response_time': round(expected_time, 2),
            'time_difference': round(time_diff, 2),
            'performance_ratio': round(current_time / expected_time if expected_time > 0 else 1.0, 2),
            'similar_incidents_count': len(historical_data)
        },
        'predicted_vs_actual': {
            'predicted': expected_time,
            'actual': current_time,
            'difference': time_diff
        },
        'performance_analysis': performance_analysis,
        'improvement_suggestions': improvement_suggestions,
        'training_recommendations': training_recommendations,
        'success_factors': success_factors,
        'contextual_factors': {
            'fire_type': incident_data.get('type', 'N/A'),
            'time_of_day': incident_data.get('time_received', 'N/A'),
            'weather_condition': incident_data.get('weather', 'N/A'),
            'distance': incident_data.get('distance', 0)
        },
        'report_details': incident_data
    }


def safe_int(value, default=0):
    """Safely convert to int"""
    if value is None or value == '':
        return default
    try:
        return int(float(str(value)))
    except (ValueError, TypeError):
        return default

def safe_float(value, default=0.0):
    """Safely convert to float"""
    if value is None or value == '':
        return default
    try:
        return float(str(value))
    except (ValueError, TypeError):
        return default

def safe_bool(value, default=False):
    """Safely convert to native Python bool"""
    if hasattr(value, 'dtype') and np.issubdtype(value.dtype, np.bool_):
        return bool(value)
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if value is None:
        return default
    try:
        return bool(value)
    except (ValueError, TypeError):
        return default

def parse_date(date_str):
    """Parse various date formats"""
    try:
        if not date_str:
            return datetime.now().isoformat()
        for fmt in ['%m/%d/%Y', '%Y-%m-%d', '%d/%m/%Y']:
            try:
                dt = datetime.strptime(date_str, fmt)
                return dt.isoformat()
            except ValueError:
                continue
        return datetime.now().isoformat()
    except:
        return datetime.now().isoformat()

def determine_severity(row):
    """Enhanced severity determination with more factors"""
    death_civ = safe_int(row.get('DEATH_CIV', row.get('death_civ', 0)))
    death_bfp = safe_int(row.get('DEATH_BFP', row.get('death_bfp', 0)))
    injured_civ = safe_int(row.get('INJURED_CIV', row.get('injured_civ', 0)))
    injured_bfp = safe_int(row.get('INJURED_BFP', row.get('injured_bfp', 0)))
    
    total_deaths = death_civ + death_bfp
    total_injured = injured_civ + injured_bfp
    
    if total_deaths > 0:
        return 'critical'
    elif total_injured > 2:
        return 'severe'
    elif total_injured > 0:
        return 'major'
    else:
        alarm_status = str(row.get('ALARM_STATUS', row.get('alarm_status', ''))).upper()
        if alarm_status in ['FA', 'FALSE_ALARM']:
            return 'minor'
        else:
            return 'moderate'

def seed_admin_user():
    """Seed default admin user if not exists"""
    try:
        admin = User.query.filter_by(username='admin@bfp.gov.ph').first()
        if not admin:
            new_admin = User(username='admin@bfp.gov.ph', password='bfpadmin000')
            db.session.add(new_admin)
            db.session.commit()
            print("Default admin user created.")
        else:
            print("Admin user already exists.")
    except Exception as e:
        print(f"Error seeding admin: {e}")

def seed_emergency_contacts():
    """Seed default emergency contacts if not exists"""
    try:
        if EmergencyContact.query.first() is not None:
            return
        
        contacts = [
            {'name': 'BFP Emergency', 'number': '(049) 808-1234', 'description': 'Bureau of Fire Protection - Santa Cruz, Laguna', 'type': 'fire'},
            {'name': 'Police Station', 'number': '(049) 808-5678', 'description': 'Santa Cruz Police Station', 'type': 'police'},
            {'name': 'Hospital', 'number': '(049) 808-9012', 'description': 'Laguna Provincial Hospital', 'type': 'medical'},
            {'name': 'Municipal Disaster Office', 'number': '(049) 808-3456', 'description': 'MDRRMO - Santa Cruz', 'type': 'other'}
        ]
        
        for c in contacts:
            db.session.add(EmergencyContact(
                name=c['name'], number=c['number'], 
                description=c['description'], type=c['type']
            ))
        db.session.commit()
        print("Default emergency contacts seeded.")
    except Exception as e:
        print(f"Error seeding emergency contacts: {e}")

def load_incidents_from_sqlite():
    """Load incidents from SQLite database sorted by ID descending (excludes soft-deleted)"""
    global fire_incidents
    try:
        # Order by ID descending so newest are first, exclude soft-deleted items
        incidents = Incident.query.filter_by(is_deleted=False).order_by(Incident.id.desc()).all()
        fire_incidents = []
        for inc in incidents:
            fire_incidents.append({
                'id': inc.id, 'station': inc.station, 'date': inc.date, 'location': inc.location,
                'responding_unit': inc.responding_unit, 'time_received': inc.time_received,
                'time_dispatched': inc.time_dispatched, 'time_arrival': inc.time_arrival,
                'response_time': inc.response_time, 'distance': inc.distance,
                'alarm_status': inc.alarm_status, 'type': inc.type,
                'injured_civ': inc.injured_civ, 'injured_bfp': inc.injured_bfp,
                'death_civ': inc.death_civ, 'death_bfp': inc.death_bfp,
                'remarks': inc.remarks, 'temperature': inc.temperature,
                'humidity': inc.humidity, 'wind_speed': inc.wind_speed,
                'precipitation': inc.precipitation, 'weather': inc.weather,
                'road_condition': inc.road_condition, 'timestamp': inc.timestamp,
                'severity': inc.severity, 'total_casualties': inc.total_casualties,
                'is_false_alarm': inc.is_false_alarm, 'is_rainy': inc.is_rainy
            })
        deleted_count = Incident.query.filter_by(is_deleted=True).count()
        print(f"Loaded {len(fire_incidents)} incidents from SQLite (excluded {deleted_count} deleted).")
    except Exception as e:
        print(f"Error loading from SQLite: {e}")

def migrate_csv_to_sqlite():
    """Migrate data from CSV to SQLite if database is empty"""
    if Incident.query.first() is not None:
        return
        
    csv_file = os.path.join(SCRIPT_DIR, 'fire-incidents.csv')
    if not os.path.exists(csv_file):
        return
        
    try:
        with open(csv_file, 'r', encoding='utf-8') as file:
            csv_reader = csv.DictReader(file)
            for row in csv_reader:
                ml_data = {
                    'severity': determine_severity(row),
                    'type': str(row.get('TYPE_OF_OCCUPANCY', 'Other')),
                    'location': row.get('LOCATION', 'Unknown'),
                    'weather': row.get('Weather_Condition', 'Unknown'),
                    'temperature': safe_float(row.get('Temperature_C', 25)),
                    'humidity': safe_float(row.get('Humidity_%', 70)),
                    'wind_speed': safe_float(row.get('Wind_Speed_kmh', 10)),
                    'precipitation': safe_float(row.get('Precipitation_mm', 0)),
                    'response_time': safe_int(row.get('RESPONSE_TIME_MIN', 0)),
                    'distance': safe_float(row.get('DISTANCE', 3.0)),
                    'date': row.get('DATE_OF_RESPONSE', ''),
                    'alarm_status': row.get('ALARM_STATUS', ''),
                    'road_condition': row.get('Road_Condition', 'Dry'),
                    'injured_civ': safe_int(row.get('INJURED_CIV', 0)),
                    'injured_bfp': safe_int(row.get('INJURED_BFP', 0)),
                    'death_civ': safe_int(row.get('DEATH_CIV', 0)),
                    'death_bfp': safe_int(row.get('DEATH_BFP', 0)),
                    'station': row.get('STATION', ''),
                    'time_received': row.get('TIME_RECEIVED', ''),
                    'time_dispatched': row.get('TIME_DISPATCHED', ''),
                    'time_arrival': row.get('TIME_ARRIVAL', ''),
                    'remarks': row.get('REMARKS', 'Case Closed')
                }
                
                total_c = ml_data['injured_civ'] + ml_data['injured_bfp'] + ml_data['death_civ'] + ml_data['death_bfp']
                is_fa = 1 if ml_data['alarm_status'] in ['FA', 'FALSE_ALARM'] else 0
                is_r = 1 if 'rain' in ml_data['weather'].lower() else 0
                
                new_inc = Incident(
                    station=ml_data['station'], date=ml_data['date'], location=ml_data['location'],
                    responding_unit=row.get('RESPONDING_UNIT', 'Shift B'),
                    time_received=ml_data['time_received'], time_dispatched=ml_data['time_dispatched'],
                    time_arrival=ml_data['time_arrival'], response_time=ml_data['response_time'],
                    distance=ml_data['distance'], alarm_status=ml_data['alarm_status'],
                    type=ml_data['type'], injured_civ=ml_data['injured_civ'],
                    injured_bfp=ml_data['injured_bfp'], death_civ=ml_data['death_civ'],
                    death_bfp=ml_data['death_bfp'], remarks=ml_data['remarks'],
                    temperature=ml_data['temperature'], humidity=ml_data['humidity'],
                    wind_speed=ml_data['wind_speed'], precipitation=ml_data['precipitation'],
                    weather=ml_data['weather'], road_condition=ml_data['road_condition'],
                    timestamp=parse_date(ml_data['date']), severity=ml_data['severity'],
                    total_casualties=total_c, is_false_alarm=is_fa, is_rainy=is_r
                )
                db.session.add(new_inc)
            db.session.commit()
            print("CSV data migrated to SQLite successfully.")
    except Exception as e:
        print(f"Error migrating CSV: {e}")

def load_hydrants_from_sqlite():
    global fire_hydrants
    try:
        hydrants = Hydrant.query.filter_by(is_deleted=False).all()
        fire_hydrants = []
        for h in hydrants:
            fire_hydrants.append({
                'id': h.id, 'number': h.number, 'address': h.address,
                'latitude': h.latitude, 'longitude': h.longitude,
                'status': h.status, 'remarks': h.remarks
            })
    except Exception as e:
        print(f"Error loading hydrants: {e}")

def migrate_hydrants_to_sqlite():
    if Hydrant.query.first() is not None:
        return
    path = os.path.join(SCRIPT_DIR, 'fire-hydrants.json')
    if not os.path.exists(path):
        return
    try:
        with open(path, 'r') as f:
            data = json.load(f)
            for h in data:
                new_h = Hydrant(
                    number=h.get('number'), address=h.get('address'),
                    latitude=h.get('latitude'), longitude=h.get('longitude'),
                    status=h.get('status', 'operational'), remarks=h.get('remarks', '')
                )
                db.session.add(new_h)
            db.session.commit()
            print("Hydrants migrated to SQLite.")
    except Exception as e:
        print(f"Error migrating hydrants: {e}")

def load_hazard_roads_from_sqlite():
    global hazard_roads
    try:
        roads = HazardRoad.query.all()
        hazard_roads = []
        for r in roads:
            hazard_roads.append({
                'id': r.id, 'name': r.name,
                'coordinates': r.coordinates, 'severity': r.severity
            })
    except Exception as e:
        print(f"Error loading hazard roads: {e}")

def migrate_hazard_roads_to_sqlite():
    if HazardRoad.query.first() is not None:
        return
    path = os.path.join(SCRIPT_DIR, 'hazard-roads.json')
    if not os.path.exists(path):
        return
    try:
        with open(path, 'r') as f:
            data = json.load(f)
            for r in data:
                new_r = HazardRoad(
                    name=r.get('name'), coordinates=r.get('coordinates'),
                    severity=r.get('severity', 'high')
                )
                db.session.add(new_r)
            db.session.commit()
            print("Hazard roads migrated to SQLite.")
    except Exception as e:
        print(f"Error migrating hazard roads: {e}")

def add_incident_to_sqlite(ml_data):
    try:
        # Create instance with explicit field mapping and type conversion
        new_inc = Incident(
            station=str(ml_data.get('station', 'Santa Cruz, Laguna')),
            date=str(ml_data.get('date', '')),
            location=str(ml_data.get('location', 'Unknown')),
            responding_unit=str(ml_data.get('responding_unit', 'Shift B')),
            time_received=str(ml_data.get('time_received', '00:00')),
            time_dispatched=str(ml_data.get('time_dispatched', '00:00')),
            time_arrival=str(ml_data.get('time_arrival', '00:00')),
            response_time=float(ml_data.get('response_time', 0)),
            distance=float(ml_data.get('distance', 0.0)),
            alarm_status=str(ml_data.get('alarm_status', 'REAL')),
            type=str(ml_data.get('type', 'Other')),
            injured_civ=int(ml_data.get('injured_civ', 0)),
            injured_bfp=int(ml_data.get('injured_bfp', 0)),
            death_civ=int(ml_data.get('death_civ', 0)),
            death_bfp=int(ml_data.get('death_bfp', 0)),
            remarks=str(ml_data.get('remarks', 'Case Closed')),
            temperature=float(ml_data.get('temperature', 25.0)),
            humidity=float(ml_data.get('humidity', 70.0)),
            wind_speed=float(ml_data.get('wind_speed', 10.0)),
            precipitation=float(ml_data.get('precipitation', 0.0)),
            weather=str(ml_data.get('weather', 'Sunny')),
            road_condition=str(ml_data.get('road_condition', 'Dry')),
            timestamp=str(ml_data.get('timestamp', datetime.now().isoformat())),
            severity=str(ml_data.get('severity', 'moderate')),
            total_casualties=int(ml_data.get('total_casualties', 0)),
            is_false_alarm=int(ml_data.get('is_false_alarm', 0)),
            is_rainy=int(ml_data.get('is_rainy', 0))
        )
        db.session.add(new_inc)
        db.session.commit()
        return new_inc.id
    except Exception as e:
        db.session.rollback()
        print(f"Error saving to SQLite: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def add_hydrant_to_sqlite(data):
    try:
        new_h = Hydrant(
            number=data.get('number'), address=data.get('address'),
            latitude=float(data.get('latitude')), longitude=float(data.get('longitude')),
            status=data.get('status', 'operational'), remarks=data.get('remarks', '')
        )
        db.session.add(new_h)
        db.session.commit()
        return new_h.id
    except Exception as e:
        print(f"Error saving hydrant to SQLite: {e}")
        return None

def add_hazard_road_to_sqlite(data):
    try:
        new_r = HazardRoad(
            name=data.get('name'), coordinates=data.get('coordinates'),
            severity=data.get('severity', 'high')
        )
        db.session.add(new_r)
        db.session.commit()
        return new_r.id
    except Exception as e:
        print(f"Error saving hazard road to SQLite: {e}")
        return None

def load_incidents_from_csv():
    """Load incidents from CSV file with enhanced data"""
    global fire_incidents
    fire_incidents = []
    csv_file = os.path.join(SCRIPT_DIR, 'fire-incidents.csv')
    
    if not os.path.exists(csv_file):
        print(f"CSV file {csv_file} not found.")
        return
    
    loaded_count = 0
    try:
        with open(csv_file, 'r', encoding='utf-8') as file:
            csv_reader = csv.DictReader(file)
            
            for row in csv_reader:
                incident_data = {
                    'severity': determine_severity(row),
                    'type': str(row.get('TYPE_OF_OCCUPANCY', 'Other')),
                    'location': row.get('LOCATION', 'Unknown'),
                    'weather': row.get('Weather_Condition', 'Unknown'),
                    'temperature': safe_float(row.get('Temperature_C', 25)),
                    'humidity': safe_float(row.get('Humidity_%', 70)),
                    'wind_speed': safe_float(row.get('Wind_Speed_kmh', 10)),
                    'precipitation': safe_float(row.get('Precipitation_mm', 0)),
                    'response_time': safe_int(row.get('RESPONSE_TIME_MIN', 0)),
                    'distance': safe_float(row.get('DISTANCE', 3.0)),
                    'date': row.get('DATE_OF_RESPONSE', ''),
                    'alarm_status': row.get('ALARM_STATUS', ''),
                    'road_condition': row.get('Road_Condition', 'Dry'),
                    'injured_civ': safe_int(row.get('INJURED_CIV', 0)),
                    'injured_bfp': safe_int(row.get('INJURED_BFP', 0)),
                    'death_civ': safe_int(row.get('DEATH_CIV', 0)),
                    'death_bfp': safe_int(row.get('DEATH_BFP', 0)),
                    'station': row.get('STATION', ''),
                    'time_received': row.get('TIME_RECEIVED', ''),
                    'time_dispatched': row.get('TIME_DISPATCHED', ''),
                    'time_arrival': row.get('TIME_ARRIVAL', '')
                }
                
                incident_data['total_casualties'] = incident_data['injured_civ'] + incident_data['injured_bfp'] + incident_data['death_civ'] + incident_data['death_bfp']
                incident_data['is_false_alarm'] = 1 if incident_data['alarm_status'] in ['FA', 'FALSE_ALARM'] else 0
                incident_data['is_rainy'] = 1 if 'rain' in incident_data['weather'].lower() else 0
                
                incident_id = len(fire_incidents) + 1
                incident_data['id'] = incident_id
                incident_data['timestamp'] = parse_date(row.get('DATE_OF_RESPONSE', ''))
                
                fire_incidents.append(incident_data)
                loaded_count += 1
        print(f"Loaded {loaded_count} incidents from CSV.")
    except Exception as e:
        print(f"Error loading CSV: {e}")

def append_to_csv(incident_data):
    """Append new incident to CSV"""
    csv_file = os.path.join(SCRIPT_DIR, 'fire-incidents.csv')
    
    # Map from incident_data keys to CSV columns
    row = {
        'STATION': incident_data.get('station', 'Santa Cruz, Laguna'),
        'DATE_OF_RESPONSE': incident_data.get('date', datetime.now().strftime('%m/%d/%Y')),
        'LOCATION': incident_data.get('location', 'Unknown'),
        'RESPONDING_UNIT': incident_data.get('responding_unit', 'Shift B'),
        'TIME_RECEIVED': incident_data.get('time_received', '08:00'),
        'TIME_DISPATCHED': incident_data.get('time_dispatched', '08:00'),
        'TIME_ARRIVAL': incident_data.get('time_arrival', '08:05'),
        'RESPONSE_TIME_MIN': incident_data.get('response_time', 5),
        'DISTANCE': safe_float(incident_data.get('distance', 3.3)),
        'ALARM_STATUS': 'FA' if incident_data.get('is_false_alarm') else incident_data.get('alarm_status', 'REAL'),
        'TIME_LAST_ALARM': f"{incident_data.get('date')} {incident_data.get('time_received', '08:00')}",
        'TYPE_OF_OCCUPANCY': incident_data.get('type', 'Other'),
        'INJURED_CIV': safe_int(incident_data.get('injured_civ', 0)),
        'INJURED_BFP': safe_int(incident_data.get('injured_bfp', 0)),
        'DEATH_CIV': safe_int(incident_data.get('death_civ', 0)),
        'DEATH_BFP': safe_int(incident_data.get('death_bfp', 0)),
        'REMARKS': incident_data.get('remarks', 'Case Closed'),
        'Temperature_C': safe_float(incident_data.get('temperature', 25.0)),
        'Humidity_%': safe_int(incident_data.get('humidity', 70)),
        'Wind_Speed_kmh': safe_float(incident_data.get('wind_speed', 10.0)),
        'Precipitation_mm': safe_float(incident_data.get('precipitation', 0.0)),
        'Weather_Condition': incident_data.get('weather', 'Sunny'),
        'Road_Condition': incident_data.get('road_condition', 'Dry')
    }
    
    try:
        file_exists = os.path.exists(csv_file)
        with open(csv_file, 'a', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
            if not file_exists:
                writer.writeheader()
            writer.writerow(row)
        return True
    except Exception as e:
        print(f"Error appending to CSV: {str(e)}")
        return False

# ENHANCED Analyzer Class from XGB
class FireIncidentAnalyzer:
    def __init__(self):
        self.model = None
        self.label_encoders = {}
        self.scaler = StandardScaler()
        self.features = [
            'severity', 'type', 'distance', 'temperature', 'humidity', 
            'wind_speed', 'precipitation', 'total_casualties', 'is_false_alarm',
            'is_rainy', 'road_condition'
        ]
        self.target = 'response_time'
        self._last_analysis = None
        self._baseline_performance = None
        self.best_model_type = None
        self.model_ensemble = None
        self.load_analyzer()
        
    def load_analyzer(self):
        """Load analyzer from file if exists"""
        model_path = os.path.join(SCRIPT_DIR, 'fire_incident_analyzer.pkl')
        try:
            if os.path.exists(model_path):
                analyzer_data = joblib.load(model_path)
                self.model = analyzer_data.get('model')
                self.label_encoders = analyzer_data.get('label_encoders', {})
                self.scaler = analyzer_data.get('scaler', StandardScaler())
                self._baseline_performance = analyzer_data.get('baseline_performance')
                self._last_analysis = analyzer_data.get('last_analysis')
                self.best_model_type = analyzer_data.get('best_model_type', 'XGBoost')
                self.model_ensemble = analyzer_data.get('model_ensemble')
                print(f"Analyzer loaded from fire_incident_analyzer.pkl (Model: {self.best_model_type})")
            else:
                print("No saved analyzer found; will train fresh")
        except Exception as e:
            print(f"Error loading analyzer: {e}")
    
    def preprocess_data(self, df):
        """ENHANCED preprocessing with feature engineering and name mapping"""
        df_processed = df.copy()
        
        # Map frontend names to model names if necessary
        name_mapping = {
            'temperature_c': 'temperature',
            'humidity_pct': 'humidity',
            'wind_speed_kmh': 'wind_speed',
            'precipitation_mm': 'precipitation',
            'type_of_occupancy': 'type',
            'response_time_min': 'response_time'
        }
        for old_name, new_name in name_mapping.items():
            if old_name in df_processed.columns and new_name not in df_processed.columns:
                df_processed[new_name] = df_processed[old_name]
        
        # Ensure target column is present for training
        if self.target in df_processed.columns:
            df_processed = df_processed.dropna(subset=[self.target, 'severity', 'type'])
        
        # Ensure severity is present (for inference)
        if 'severity' not in df_processed.columns:
            df_processed['severity'] = df_processed.apply(determine_severity, axis=1)
        
        # Ensure numeric columns are properly formatted
        numeric_cols = ['temperature', 'humidity', 'wind_speed', 'precipitation', 
                       'response_time', 'distance', 'total_casualties']
        for col in numeric_cols:
            if col in df_processed.columns:
                df_processed[col] = pd.to_numeric(df_processed[col], errors='coerce')
                if df_processed[col].isna().any():
                    df_processed[col] = df_processed[col].fillna(df_processed[col].median() if not df_processed[col].empty else 0)
        
        # Ensure other engineered features are present
        if 'total_casualties' not in df_processed.columns:
            df_processed['total_casualties'] = 0 # Default for new incidents if not provided
            
        if 'is_false_alarm' not in df_processed.columns:
            df_processed['is_false_alarm'] = df_processed.apply(lambda r: 1 if str(r.get('alarm_status', '')).upper() in ['FA', 'FALSE_ALARM'] else 0, axis=1)
            
        if 'is_rainy' not in df_processed.columns:
            df_processed['is_rainy'] = df_processed.apply(lambda r: 1 if 'rain' in str(r.get('weather', '')).lower() else 0, axis=1)
        
        # Remove extreme outliers in response_time during training
        if self.target in df_processed.columns and len(df_processed) > 1:
            df_processed = df_processed[(df_processed[self.target] >= 1) & (df_processed[self.target] <= 45)]
        
        # Enhanced categorical encoding
        categorical_columns = ['severity', 'type', 'road_condition']
        for col in categorical_columns:
            if col in df_processed.columns:
                if col not in self.label_encoders:
                    # Initialize with some default categories to avoid errors during fit
                    self.label_encoders[col] = LabelEncoder()
                    # Try to fit with some common values first
                    common_values = {
                        'severity': ['minor', 'moderate', 'major', 'severe', 'critical'],
                        'type': ['Residential', 'Business', 'Industrial', 'Educational', 'Mercantile', 'Storage', 'Grass/Forest', 'Vehicle', 'Other'],
                        'road_condition': ['Dry', 'Wet', 'Flooded', 'Muddy']
                    }
                    self.label_encoders[col].fit(common_values[col])
                
                # Use transform with handling for unseen labels
                try:
                    # Map unseen labels to 'Other' or first label if necessary
                    def safe_transform(val):
                        val_str = str(val)
                        if val_str not in self.label_encoders[col].classes_:
                            # If unseen, return first class or a default if possible
                            return self.label_encoders[col].transform([self.label_encoders[col].classes_[0]])[0]
                        return self.label_encoders[col].transform([val_str])[0]
                    
                    df_processed[col] = df_processed[col].apply(safe_transform)
                except Exception as e:
                    print(f"Encoding error for {col}: {e}")
                    df_processed[col] = 0
        
        # Ensure all features are present with defaults
        for feature in self.features:
            if feature not in df_processed.columns:
                defaults = {
                    'temperature': 25, 'humidity': 70, 'wind_speed': 10, 
                    'distance': 3.0, 'severity': 1, 'type': 0,
                    'precipitation': 0, 'total_casualties': 0, 'is_false_alarm': 0,
                    'is_rainy': 0, 'road_condition': 0
                }
                df_processed[feature] = defaults.get(feature, 0)
        
        return df_processed
    
    def create_ensemble_model(self, X, y):
        """Create ensemble of models for better accuracy"""
        models = {
            'xgb': xgb.XGBRegressor(
                n_estimators=200, max_depth=8, learning_rate=0.1,
                subsample=0.8, colsample_bytree=0.8, random_state=42
            ),
            'rf': RandomForestRegressor(n_estimators=150, max_depth=10, random_state=42),
            'gbr': GradientBoostingRegressor(n_estimators=150, learning_rate=0.1, max_depth=6, random_state=42)
        }
        
        trained_models = {}
        for name, model in models.items():
            model.fit(X, y)
            trained_models[name] = model
        return trained_models
    
    def ensemble_predict(self, X, ensemble_models):
        """Get weighted prediction from ensemble"""
        predictions = []
        weights = {'xgb': 0.5, 'rf': 0.3, 'gbr': 0.2}
        for name, model in ensemble_models.items():
            pred = model.predict(X)
            predictions.append(pred * weights[name])
        return np.sum(predictions, axis=0)
    
    def train_analyzer(self, incidents_data):
        """ADVANCED training with ensemble methods"""
        try:
            if len(incidents_data) < 5:
                return {'error': f'Need at least 5 incidents for training. Got {len(incidents_data)}'}
            
            df = pd.DataFrame(incidents_data)
            df_processed = self.preprocess_data(df)
            
            if len(df_processed) < 5:
                return {'error': 'Not enough valid data after cleaning.'}
            
            X = df_processed[self.features]
            y = df_processed[self.target]
            
            X_scaled = self.scaler.fit_transform(X)
            
            if len(X) >= 30:
                ensemble_models = self.create_ensemble_model(X_scaled, y)
                self.model_ensemble = ensemble_models
                self.model = ensemble_models['xgb']
                self.best_model_type = 'XGBoost_Ensemble'
                y_pred = self.ensemble_predict(X_scaled, ensemble_models)
            else:
                self.model = xgb.XGBRegressor(n_estimators=200, max_depth=6, learning_rate=0.15, random_state=42)
                self.model.fit(X_scaled, y)
                self.best_model_type = 'XGBoost'
                y_pred = self.model.predict(X_scaled)
            
            full_r2 = r2_score(y, y_pred)
            full_mae = mean_absolute_error(y, y_pred)
            
            baseline_performance = {
                'mae': float(full_mae),
                'r2': float(full_r2),
                'accuracy': float(full_r2),
                'avg_response_time': float(y.mean()),
                'training_samples': int(len(X)),
                'algorithm': self.best_model_type,
                'target_achieved': bool(full_r2 >= 0.85),
                'model_ensemble_used': bool(self.model_ensemble is not None),
                'timestamp': datetime.now().isoformat()
            }
            
            self._baseline_performance = convert_to_native_types(baseline_performance)
            self.save_analyzer()
            return self._baseline_performance
        except Exception as e:
            print(f"Training error: {e}")
            return {'error': str(e)}

    def compare_incident(self, new_incident_data, historical_data=None):
        """Compare new incident against historical patterns"""
        if not self.model:
            return {'error': 'Analyzer not trained'}
        
        try:
            new_df = pd.DataFrame([new_incident_data])
            new_df_processed = self.preprocess_data(new_df)
            X_scaled = self.scaler.transform(new_df_processed[self.features])
            
            if self.model_ensemble:
                expected_time = float(self.ensemble_predict(X_scaled, self.model_ensemble)[0])
            else:
                expected_time = float(self.model.predict(X_scaled)[0])
                
            actual_time = float(new_incident_data.get('response_time', expected_time))
            time_difference = actual_time - expected_time
            performance_ratio = actual_time / expected_time if expected_time > 0 else 1.0
            
            comparison_result = {
                'expected_response_time': round(expected_time, 2),
                'actual_response_time': round(actual_time, 2),
                'time_difference': round(time_difference, 2),
                'performance_ratio': round(performance_ratio, 2),
                'performance_category': 'excellent' if performance_ratio < 0.9 else 'good' if performance_ratio < 1.1 else 'needs_improvement',
                'algorithm': self.best_model_type,
                'confidence': float(self._baseline_performance.get('r2', 0.5) if self._baseline_performance else 0.5)
            }
            
            self._last_analysis = {
                'timestamp': datetime.now().isoformat(),
                'result': convert_to_native_types(comparison_result)
            }
            return comparison_result
        except Exception as e:
            print(f"Comparison error: {e}")
            return {'error': str(e)}

    def save_analyzer(self):
        """Save analyzer to file"""
        model_path = os.path.join(SCRIPT_DIR, 'fire_incident_analyzer.pkl')
        try:
            if self.model is None: return
            analyzer_data = {
                'model': self.model,
                'label_encoders': self.label_encoders,
                'scaler': self.scaler,
                'baseline_performance': self._baseline_performance,
                'last_analysis': self._last_analysis,
                'features': self.features,
                'target': self.target,
                'best_model_type': self.best_model_type,
                'model_ensemble': self.model_ensemble
            }
            joblib.dump(analyzer_data, model_path)
            print(f"Analyzer saved to {model_path}")
        except Exception as e:
            print(f"Error saving analyzer: {e}")

# Initialize global analyzer
fire_analyzer = FireIncidentAnalyzer()

# Root route
@app.route('/')
def serve_dashboard():
    return render_template('dashboard.html')

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'incidents_count': len(fire_incidents),
        'analyzer_ready': fire_analyzer.model is not None
    })

@app.route('/api/model-status', methods=['GET'])
def model_status():
    if not fire_analyzer._baseline_performance:
        return jsonify({'status': 'needs_training', 'accuracy': 0})
    return jsonify(convert_to_native_types(fire_analyzer._baseline_performance))

@app.route('/api/incidents', methods=['GET', 'POST'])
def manage_incidents():
    global fire_incidents
    if request.method == 'GET':
        load_incidents_from_sqlite() # Refresh from DB
        return jsonify({'incidents': fire_incidents, 'count': len(fire_incidents)})
    
    elif request.method == 'POST':
        data = request.json
        # Map frontend fields to ML fields
        ml_data = {
            'severity': determine_severity(data),
            'type': data.get('type_of_occupancy') or data.get('type') or 'Other',
            'location': data.get('location') or 'Unknown',
            'weather': data.get('weather_condition') or data.get('weather') or 'Sunny',
            'temperature': safe_float(data.get('temperature_c') or data.get('temperature'), 25),
            'humidity': safe_float(data.get('humidity_pct') or data.get('humidity'), 70),
            'wind_speed': safe_float(data.get('wind_speed_kmh') or data.get('wind_speed'), 10),
            'precipitation': safe_float(data.get('precipitation_mm') or data.get('precipitation'), 0),
            'response_time': safe_int(data.get('response_time_min') or data.get('response_time'), 5),
            'distance': safe_float(data.get('distance'), 3.3),
            'road_condition': data.get('road_condition') or 'Dry',
            'alarm_status': data.get('alarm_status') or 'REAL',
            'injured_civ': safe_int(data.get('injured_civ'), 0),
            'injured_bfp': safe_int(data.get('injured_bfp'), 0),
            'death_civ': safe_int(data.get('death_civ'), 0),
            'death_bfp': safe_int(data.get('death_bfp'), 0),
            'station': data.get('station') or 'Santa Cruz, Laguna',
            'remarks': data.get('remarks') or 'Case Closed',
            'date': data.get('date_of_response') or data.get('date') or datetime.now().strftime('%Y-%m-%d'),
            'responding_unit': data.get('responding_unit') or 'Shift B',
            'time_received': data.get('time_received') or '08:00',
            'time_dispatched': data.get('time_dispatched') or '08:00',
            'time_arrival': data.get('time_arrival') or '08:05'
        }
        
        ml_data['total_casualties'] = ml_data['injured_civ'] + ml_data['injured_bfp'] + ml_data['death_civ'] + ml_data['death_bfp']
        ml_data['is_false_alarm'] = 1 if ml_data['alarm_status'] in ['FA', 'FALSE_ALARM'] else 0
        ml_data['is_rainy'] = 1 if 'rain' in ml_data['weather'].lower() else 0
        ml_data['timestamp'] = datetime.now().isoformat()
        
        # Save to SQLite
        new_id = add_incident_to_sqlite(ml_data)
        if new_id:
            ml_data['id'] = new_id
            print(f"Incident saved to SQLite with ID: {new_id}")
        else:
            print("Failed to save incident to SQLite")
            # Generate a temporary ID if SQLite fails
            ml_data['id'] = len(fire_incidents) + 1
        
        # Also keep CSV for backup
        append_to_csv(ml_data)
        
        # Update in-memory list
        fire_incidents.append(ml_data)
        
        comparison = {}
        if fire_analyzer.model:
            comparison = fire_analyzer.compare_incident(ml_data)
            
        return jsonify({
            'message': 'Incident stored successfully',
            'id': ml_data['id'],
            'timestamp': ml_data['timestamp'],
            'comparison_analysis': comparison
        })

@app.route('/api/incidents/<int:incident_id>', methods=['DELETE'])
def delete_incident(incident_id):
    """Soft delete an incident (move to trash)"""
    try:
        incident = Incident.query.get(incident_id)
        if incident:
            # Soft delete: mark as deleted instead of removing from database
            incident.is_deleted = True
            incident.deleted_at = datetime.now()
            db.session.commit()
            # Also refresh the in-memory list
            load_incidents_from_sqlite()
            return jsonify({'success': True, 'message': f'Incident {incident_id} deleted successfully'})
        return jsonify({'success': False, 'error': 'Incident not found'}), 404
    except Exception as e:
        print(f"Error deleting incident: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/statistics', methods=['GET'])
def get_statistics():
    if not fire_incidents: return jsonify({'statistics': {}})
    df = pd.DataFrame(fire_incidents)
    stats = {
        'total_incidents': len(df),
        'average_response_time': float(df['response_time'].mean()),
        'average_distance': float(df['distance'].mean()),
        'by_severity': df['severity'].value_counts().to_dict() if 'severity' in df.columns else {}
    }
    return jsonify(stats)

@app.route('/api/train', methods=['POST'])
def train_route():
    if len(fire_incidents) < 5:
        return jsonify({'error': 'Need at least 5 incidents'}), 400
    performance = fire_analyzer.train_analyzer(fire_incidents)
    return jsonify({'message': 'Training complete', 'performance': performance})

# HYDRANTS & HAZARD ROADS
@app.route('/api/hydrants', methods=['GET', 'POST'])
def manage_hydrants():
    global fire_hydrants
    if request.method == 'GET':
        load_hydrants_from_sqlite()
        return jsonify({'hydrants': fire_hydrants})
    
    try:
        data = request.json
        new_id = add_hydrant_to_sqlite(data)
        if new_id is None:
            return jsonify({'success': False, 'error': 'Failed to save hydrant to database'}), 500
        
        hydrant = {
            'id': new_id, 'number': data.get('number'),
            'address': data.get('address'), 'latitude': float(data.get('latitude')),
            'longitude': float(data.get('longitude')), 'status': data.get('status', 'operational'),
            'remarks': data.get('remarks', '')
        }
        fire_hydrants.append(hydrant)
        return jsonify({'success': True, 'hydrant': hydrant})
    except Exception as e:
        print(f"Error adding hydrant: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/hydrants/<int:hydrant_id>', methods=['PUT', 'DELETE'])
def manage_single_hydrant(hydrant_id):
    global fire_hydrants
    try:
        hydrant = Hydrant.query.get(hydrant_id)
        if not hydrant:
            return jsonify({'success': False, 'error': 'Hydrant not found'}), 404
        
        if request.method == 'PUT':
            # Update hydrant
            data = request.json
            hydrant.number = data.get('number', hydrant.number)
            hydrant.address = data.get('address', hydrant.address)
            hydrant.latitude = float(data.get('latitude', hydrant.latitude))
            hydrant.longitude = float(data.get('longitude', hydrant.longitude))
            hydrant.status = data.get('status', hydrant.status)
            hydrant.remarks = data.get('remarks', hydrant.remarks)
            
            db.session.commit()
            
            # Update in-memory list
            fire_hydrants_updated = []
            for h in fire_hydrants:
                if h['id'] == hydrant_id:
                    h['number'] = hydrant.number
                    h['address'] = hydrant.address
                    h['latitude'] = hydrant.latitude
                    h['longitude'] = hydrant.longitude
                    h['status'] = hydrant.status
                    h['remarks'] = hydrant.remarks
                fire_hydrants_updated.append(h)
            fire_hydrants.clear()
            fire_hydrants.extend(fire_hydrants_updated)
            
            return jsonify({'success': True, 'hydrant': {
                'id': hydrant.id,
                'number': hydrant.number,
                'address': hydrant.address,
                'latitude': hydrant.latitude,
                'longitude': hydrant.longitude,
                'status': hydrant.status,
                'remarks': hydrant.remarks
            }})
        
        elif request.method == 'DELETE':
            # Soft delete hydrant
            hydrant.is_deleted = True
            hydrant.deleted_at = datetime.now()
            db.session.commit()
            
            # Update in-memory list
            fire_hydrants[:] = [h for h in fire_hydrants if h['id'] != hydrant_id]
            
            return jsonify({'success': True, 'message': 'Hydrant deleted successfully'})
    
    except Exception as e:
        print(f"Error managing hydrant: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/hazard-roads', methods=['GET', 'POST'])
def manage_hazard_roads():
    global hazard_roads
    if request.method == 'GET':
        load_hazard_roads_from_sqlite()
        return jsonify({'hazard_roads': hazard_roads})
    data = request.json
    new_id = add_hazard_road_to_sqlite(data)
    hazard = {
        'id': new_id, 'name': data.get('name'),
        'coordinates': data.get('coordinates'), 'severity': data.get('severity', 'high')
    }
    hazard_roads.append(hazard)
    return jsonify({'success': True, 'hazard_road': hazard})

@app.route('/api/hazard-roads/<int:hazard_id>', methods=['DELETE'])
def delete_hazard_road(hazard_id):
    try:
        road = HazardRoad.query.get(hazard_id)
        if road:
            road.is_deleted = True
            road.deleted_at = datetime.now()
            db.session.commit()
            return jsonify({'success': True})
        return jsonify({'success': False, 'error': 'Not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# TRASH / RECYCLE BIN
@app.route('/api/trash', methods=['GET'])
def get_trash():
    """Get all deleted items (incidents, hydrants, contacts)"""
    try:
        deleted_incidents = Incident.query.filter_by(is_deleted=True).all()
        deleted_hydrants = Hydrant.query.filter_by(is_deleted=True).all()
        deleted_contacts = EmergencyContact.query.filter_by(is_deleted=True).all()
        
        return jsonify({
            'success': True,
            'trash': {
                'incidents': [{
                    'id': i.id, 'location': i.location, 'date': i.date,
                    'distance': i.distance, 'response_time': i.response_time,
                    'type': i.type, 'alarm_status': i.alarm_status,
                    'deleted_at': i.deleted_at.isoformat() if i.deleted_at else None,
                    'type_category': 'incident'
                } for i in deleted_incidents],
                'hydrants': [{
                    'id': h.id, 'number': h.number, 'address': h.address,
                    'latitude': h.latitude, 'longitude': h.longitude,
                    'status': h.status, 'remarks': h.remarks,
                    'deleted_at': h.deleted_at.isoformat() if h.deleted_at else None,
                    'type_category': 'hydrant'
                } for h in deleted_hydrants],
                'contacts': [{
                    'id': c.id, 'name': c.name, 'number': c.number,
                    'description': c.description, 'type': c.type,
                    'deleted_at': c.deleted_at.isoformat() if c.deleted_at else None,
                    'type_category': 'contact'
                } for c in deleted_contacts]
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/trash/restore/<string:item_type>/<int:item_id>', methods=['POST'])
def restore_from_trash(item_type, item_id):
    """Restore a deleted item from trash"""
    try:
        if item_type == 'incident':
            item = Incident.query.get(item_id)
            if item:
                item.is_deleted = False
                item.deleted_at = None
                db.session.commit()
                return jsonify({'success': True, 'message': 'Incident restored successfully'})
        elif item_type == 'hydrant':
            item = Hydrant.query.get(item_id)
            if item:
                item.is_deleted = False
                item.deleted_at = None
                db.session.commit()
                load_hydrants_from_sqlite()
                return jsonify({'success': True, 'message': 'Hydrant restored successfully'})
        elif item_type == 'contact':
            item = EmergencyContact.query.get(item_id)
            if item:
                item.is_deleted = False
                item.deleted_at = None
                db.session.commit()
                return jsonify({'success': True, 'message': 'Contact restored successfully'})
        
        return jsonify({'success': False, 'error': 'Item not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/trash/delete/<string:item_type>/<int:item_id>', methods=['DELETE'])
def permanently_delete(item_type, item_id):
    """Permanently delete an item from trash"""
    try:
        if item_type == 'incident':
            item = Incident.query.get(item_id)
        elif item_type == 'hydrant':
            item = Hydrant.query.get(item_id)
        elif item_type == 'contact':
            item = EmergencyContact.query.get(item_id)
        else:
            return jsonify({'success': False, 'error': 'Invalid item type'}), 400
        
        if item and item.is_deleted:
            db.session.delete(item)
            db.session.commit()
            return jsonify({'success': True, 'message': 'Item permanently deleted'})
        
        return jsonify({'success': False, 'error': 'Item not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/trash/empty', methods=['DELETE'])
def empty_trash():
    """Permanently delete all items from trash"""
    try:
        Incident.query.filter_by(is_deleted=True).delete()
        Hydrant.query.filter_by(is_deleted=True).delete()
        EmergencyContact.query.filter_by(is_deleted=True).delete()
        db.session.commit()
        return jsonify({'success': True, 'message': 'Trash emptied successfully'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/contacts', methods=['GET', 'POST'])
def manage_contacts():
    """Get or add emergency contacts"""
    if request.method == 'GET':
        contacts = EmergencyContact.query.all()
        return jsonify({
            'success': True,
            'contacts': [{
                'id': c.id, 'name': c.name, 'number': c.number,
                'description': c.description, 'type': c.type
            } for c in contacts]
        })
    
    elif request.method == 'POST':
        try:
            data = request.json
            new_contact = EmergencyContact(
                name=data.get('name'),
                number=data.get('number'),
                description=data.get('description'),
                type=data.get('type', 'other')
            )
            db.session.add(new_contact)
            db.session.commit()
            return jsonify({'success': True, 'message': 'Contact added successfully'})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
def delete_contact(contact_id):
    """Delete an emergency contact"""
    try:
        contact = EmergencyContact.query.get(contact_id)
        if contact:
            db.session.delete(contact)
            db.session.commit()
            return jsonify({'success': True, 'message': 'Contact deleted successfully'})
        return jsonify({'success': False, 'error': 'Contact not found'}), 404
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/road-conditions', methods=['GET', 'POST'])
def get_road_conditions():
    """Get real-time road conditions for Santa Cruz, Laguna area"""
    try:
        # Handle POST request with optional coordinates for localized conditions
        data = request.json if request.method == 'POST' else {}
        lat = data.get('lat') or request.args.get('lat', 14.272416)
        lng = data.get('lng') or request.args.get('lng', 121.401435)
        radius = data.get('radius') or request.args.get('radius', 3)  # 3 km radius
        
        # Real-time road conditions data for Santa Cruz, Laguna
        # This data can be updated from external traffic APIs or local database
        road_conditions = {
            'timestamp': datetime.now().isoformat(),
            'location': {
                'lat': float(lat),
                'lng': float(lng),
                'area': 'Santa Cruz, Laguna',
                'search_radius_km': int(radius)
            },
            'traffic_conditions': [
                {
                    'location': 'Jose Rizal Avenue',
                    'lat': 14.2750,
                    'lng': 121.4000,
                    'status': 'moderate',
                    'congestion_level': 3,  # 1-5 scale, 5 is worst
                    'estimated_speed': 20,  # km/h
                    'description': 'Moderate traffic in the morning hours',
                    'distance_from_point': 0.5  # km
                },
                {
                    'location': 'Manila S Road',
                    'lat': 14.2780,
                    'lng': 121.4050,
                    'status': 'heavy',
                    'congestion_level': 4,
                    'estimated_speed': 15,  # km/h
                    'description': 'Heavy traffic due to market operations',
                    'distance_from_point': 1.2
                },
                {
                    'location': 'San Luis Avenue',
                    'lat': 14.2650,
                    'lng': 121.4100,
                    'status': 'light',
                    'congestion_level': 1,
                    'estimated_speed': 45,  # km/h
                    'description': 'Light traffic, smooth flow',
                    'distance_from_point': 1.8
                }
            ],
            'road_works': [
                {
                    'location': 'Arellano Avenue - near Adventist Church',
                    'lat': 14.2700,
                    'lng': 121.3950,
                    'status': 'active',
                    'type': 'road_construction',
                    'description': 'Road maintenance - one lane closure on northbound',
                    'affected_lanes': '1 lane (northbound)',
                    'expected_duration': '2 weeks',
                    'severity': 'medium',
                    'distance_from_point': 0.8,
                    'advisory': 'Expect 5-10 minute delays during peak hours'
                },
                {
                    'location': 'Rizal Avenue Extension',
                    'lat': 14.2600,
                    'lng': 121.4150,
                    'status': 'active',
                    'type': 'utility_work',
                    'description': 'Water main installation - intermittent traffic control',
                    'affected_lanes': 'Alternating lanes',
                    'expected_duration': '5 days',
                    'severity': 'low',
                    'distance_from_point': 2.1,
                    'advisory': 'Expect minor delays, use alternative routes if possible'
                }
            ],
            'weather_impact': {
                'current_condition': 'Clouds',
                'visibility': 'Good',
                'precipitation': 'None',
                'road_surface': 'Dry',
                'impact_on_traffic': 'No significant weather-related delays expected'
            },
            'incidents': [
                {
                    'location': 'Intersection of Manuel S Rd and Arellano Ave',
                    'lat': 14.2720,
                    'lng': 121.3980,
                    'type': 'accident',
                    'severity': 'minor',
                    'description': 'Minor vehicle collision, no injuries reported',
                    'lanes_affected': 1,
                    'estimated_clearance': '15 minutes',
                    'distance_from_point': 1.3
                }
            ],
            'recommended_routes': [
                {
                    'name': 'Route via Arellano Avenue (Recommended)',
                    'estimated_time': '12 minutes',
                    'estimated_distance': '4.2 km',
                    'status': 'good',
                    'traffic_delays': 'estimated 2-3 min'
                },
                {
                    'name': 'Route via San Luis Avenue',
                    'estimated_time': '15 minutes',
                    'estimated_distance': '5.1 km',
                    'status': 'fair',
                    'traffic_delays': 'None expected'
                }
            ],
            'summary': {
                'overall_status': 'moderate',
                'major_delays': 1,
                'active_incidents': 1,
                'active_road_works': 2,
                'recommendation': 'Road conditions are generally acceptable with some minor congestion. Avoid Jose Rizal Avenue during peak hours.'
            }
        }
        
        return jsonify(road_conditions)
    
    except Exception as e:
        return jsonify({
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/api/comprehensive-feedback', methods=['GET', 'POST'])
def get_comprehensive_feedback():
    """Get comprehensive feedback for an incident"""
    try:
        if request.method == 'GET':
            incident_id = request.args.get('incident_id')
            if not incident_id:
                return jsonify({'error': 'incident_id required'}), 400
            
            incident_data = next((inc for inc in fire_incidents if str(inc.get('id')) == str(incident_id)), None)
            if not incident_data:
                return jsonify({'error': f'Incident {incident_id} not found'}), 404
        else:
            data = request.json
            incident_data = data.get('incident_data', {})

        if not fire_analyzer.model:
            return jsonify({'error': 'Model not trained'}), 500

        comparison = fire_analyzer.compare_incident(incident_data)
        feedback = generate_comprehensive_feedback(incident_data, comparison, fire_incidents)
        
        return jsonify(convert_to_native_types(feedback))
    except Exception as e:
        print(f"Error in comprehensive feedback: {e}")
        return jsonify({'error': str(e)}), 500

def save_hazard_roads_to_file():
    with open(os.path.join(SCRIPT_DIR, 'hazard-roads.json'), 'w') as f:
        json.dump(hazard_roads, f, indent=2)

def load_hazard_roads_from_file():
    global hazard_roads
    if os.path.exists('hazard-roads.json'):
        with open('hazard-roads.json', 'r') as f: hazard_roads = json.load(f)

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        seed_admin_user()
        seed_emergency_contacts()
        migrate_csv_to_sqlite()
        migrate_hydrants_to_sqlite()
        migrate_hazard_roads_to_sqlite()
        load_incidents_from_sqlite()
        load_hydrants_from_sqlite()
        load_hazard_roads_from_sqlite()
    app.run(debug=True, host='0.0.0.0', port=5000)
