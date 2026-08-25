import logging
from typing import List, Dict, Any
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)

class DatabaseError(Exception):
    """Custom exception for database errors."""
    pass

class PostgresClient:
    def __init__(self, connection_string: str, table_name: str):
        """
        Establishes a connection pool using SQLAlchemy.
        """
        self.engine = create_engine(connection_string, pool_size=10, max_overflow=20)
        self.Session = sessionmaker(bind=self.engine)
        self.table_name = table_name

    def create_table_if_not_exists(self, columns: List[str]):
        """Dynamically create the table based on the first batch if it doesn't exist."""
        session = self.Session()
        try:
            # Basic TEXT mapping for all columns for raw ingestion
            # We let dbt handle the strict type casting in staging
            col_defs = ", ".join([f"{col} TEXT" for col in columns])
            query = f"CREATE TABLE IF NOT EXISTS {self.table_name} ({col_defs});"
            session.execute(query)
            session.commit()
        except SQLAlchemyError as e:
            session.rollback()
            logger.error(f"Failed to create table {self.table_name}: {e}")
        finally:
            session.close()

    def insert_batch(self, data: List[Dict[str, Any]]) -> bool:
        """
        Receives a chunk of data (e.g., 100,000 rows) and initiates a database transaction.
        Executes a bulk insert (utilizing PostgreSQL's executemany/execute_values).
        Commits the transaction if successful, or rolls back on failure.
        """
        if not data:
            return True
        
        # Extract columns dynamically from the first record
        columns = list(data[0].keys())
        # Ensure table exists (for local testing mostly)
        self.create_table_if_not_exists(columns)

        # Prepare the insert query
        columns_str = ', '.join(columns)
        
        # We need a plain connection from psycopg2 to use execute_values efficiently
        # SQLAlchemy provides access to the raw connection
        session = self.Session()
        try:
            connection = session.connection().connection
            with connection.cursor() as cursor:
                query = f"INSERT INTO {self.table_name} ({columns_str}) VALUES %s"
                
                # Extract values as tuples in the same order as columns
                values = [[record.get(col) for col in columns] for record in data]
                
                execute_values(cursor, query, values)
                
            session.commit()
            logger.info(f"Successfully inserted {len(data)} rows into {self.table_name}.")
            return True
        except Exception as e:
            session.rollback()
            logger.error(f"Failed to insert batch into {self.table_name}. Error: {e}")
            raise DatabaseError(f"Database insertion failed: {e}") from e
        finally:
            session.close()
