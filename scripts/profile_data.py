import pandas as pd
from ydata_profiling import ProfileReport

def profile_dataset(file_path: str, output_path: str):
    """
    Reads the synthetic telemetry JSON data, flattens it, 
    and generates a detailed statistical HTML report.
    """
    # Load JSON lines into a pandas DataFrame
    df = pd.read_json(file_path, lines=True)
    
    # Flatten nested JSON structures for analysis
    # E.g., 'user.id' -> 'user_id'
    if 'user' in df.columns:
        user_df = pd.json_normalize(df['user'])
        user_df.columns = [f"user_{col}" for col in user_df.columns]
        df = pd.concat([df.drop(['user'], axis=1), user_df], axis=1)
        
    if 'metadata' in df.columns:
        meta_df = pd.json_normalize(df['metadata'])
        meta_df.columns = [f"meta_{col}" for col in meta_df.columns]
        df = pd.concat([df.drop(['metadata'], axis=1), meta_df], axis=1)

    print(f"Generating profile report for {len(df)} records...")
    
    # Generate the ProfileReport
    profile = ProfileReport(df, title="Project Aether Telemetry Data Profiling", explorative=True)
    
    # Save the report
    profile.to_file(output_path)
    print(f"Profiling complete. Report saved to {output_path}")

if __name__ == "__main__":
    profile_dataset("sample_telemetry.json", "profiling_report.html")
