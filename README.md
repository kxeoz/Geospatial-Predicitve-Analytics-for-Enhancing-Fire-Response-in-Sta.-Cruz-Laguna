# Geospatial Predicitve Analytics for Enhancing Fire Response in-Sta. Cruz Laguna

An intelligent data science platform designed to enhance fire management, risk assessment, and resource deployment. By leveraging ensemble machine learning techniques, this system analyzes historical incident records, environmental factors, and spatial data to predict fire vulnerability and optimize emergency response strategies.

![System Front Page](images/front_page.jfif)

## 🚀 Key Features

*   **Predictive Risk Modeling:** Utilizes a high-performance ensemble learning framework to classify and predict fire risk levels across localized zones.
*   **Ensemble Learning Engine:** Combines the predictive power of **XGBoost** and **Random Forest** algorithms to ensure robust, accurate, and stable risk assessments.
*   **Data Science Dashboard:** Translates complex model outputs into actionable, data-driven insights for public safety officials and emergency responders.
*   **Geospatial & Trend Analysis:** (Optional if applicable) Identifies localized fire hotspots and historical trends to assist in preventative planning and resource allocation.

## 🛠️ Tech Stack

*   **Machine Learning & Data Science:** Python, XGBoost, Scikit-Learn (Random Forest), Pandas, NumPy
*   **Data Visualization:** Matplotlib, Seaborn
*   **Database Management:** SQL
*   **Application Framework:** *[Insert your frontend/backend stack here, e.g., React, TypeScript, Laravel, etc.]*

## 📊 Model & Architecture

The core of the system relies on an ensemble learning approach to minimize variance and bias, ensuring reliable predictions even with complex public safety datasets:

1.  **Data Preprocessing & Feature Engineering:** Cleaning historical fire incident logs, handling missing values, and engineering temporal/environmental features.
2.  **Random Forest Classifier:** Handles high-dimensional data and reduces overfitting by aggregating multiple decision trees.
3.  **XGBoost (Extreme Gradient Boosting):** Optimizes prediction speed and accuracy through gradient-boosted decision trees, capturing non-linear relationships efficiently.
4.  **Ensemble Integration:** Combines model probabilities to output a finalized localized fire risk index.

## ⚙️ Installation & Setup

### Prerequisites
* Python 3.8+
* Pip (Python package manager)
* Python 3.7+ (for Flask application)
* Python Libraries (from requirements.txt):
* Flask 2.3.3 - Web framework
* Flask-CORS 4.0.0 - Cross-origin requests
* Pandas 2.0.3 - Data processing
* NumPy 1.24.3 - Numerical computing
* Scikit-learn 1.3.0 - Machine learning
* XGBoost 2.0.0 - ML model training
* Joblib 1.3.2 - Model serialization
* SQLAlchemy 2.0.23 - ORM
* Flask-SQLAlchemy 3.1.1 - Database integration
* SciPy 1.11.1 - Scientific computing

### Frontend Requirements
* Modern Web Browser (Chrome, Firefox, Edge, Safari)
* JavaScript (ES6+)
* APIs/Services:
* Google Maps API (for mapping and navigation)
* Leaflet.js (alternative mapping library)

### Database
* SQLite 3 (embedded, no separate installation needed)
* Pre-configured database file: fire_response.db
* Data Requirements
* Training Data Files:
* fire-incidents.csv - Historical fire incident data
* fire-hydrants.json - Hydrant location data
* hazard-roads.json - Road hazard information

### Steps
1. **Clone the repository:**
   ```bash
   git clone [https://github.com/kxeoz/Geospatial-Predicitve-Analytics-for-Enhancing-Fire-Response-in-Sta.-Cruz-Laguna.git](https://github.com/kxeoz/Geospatial-Predicitve-Analytics-for-Enhancing-Fire-Response-in-Sta.-Cruz-Laguna.git)
   cd Geospatial-Predicitve-Analytics-for-Enhancing-Fire-Response-in-Sta.-Cruz-Laguna
