import os
import pandas as pd
from ydata_profiling import ProfileReport

def profile_dataset(file_path: str, output_path: str):
    """
    Reads the weather telemetry JSON Lines data (live & historical observations)
    and generates a detailed statistical HTML report.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Telemetry file not found: {file_path}")
    
    # Load JSON lines into a pandas DataFrame
    df = pd.read_json(file_path, lines=True)

    stations = df['location'].unique().tolist() if 'location' in df.columns else []
    print(f"Generating profile report for {len(df)} telemetry records across locations: {stations}...")
    
    # Generate the ProfileReport
    profile = ProfileReport(df, title="Project Aether Weather Telemetry Profiling", explorative=True)
    
    # Save the report
    profile.to_file(output_path)
    print(f"Profiling complete. Report saved to {output_path}")

if __name__ == "__main__":
    default_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docs", "sample_telemetry.json")
    profile_dataset(default_path, "profiling_report.html")
