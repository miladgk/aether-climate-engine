import os
import pytest
import boto3
from moto import mock_aws
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Setup environment variables for testing
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['AWS_SECURITY_TOKEN'] = 'testing'
os.environ['AWS_SESSION_TOKEN'] = 'testing'
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'
os.environ['S3_TELEMETRY_BUCKET'] = 'test-bucket'

os.environ['POSTGRES_HOST'] = 'localhost'
os.environ['POSTGRES_PORT'] = '5432'
os.environ['POSTGRES_DB'] = 'test_db'
os.environ['POSTGRES_USER'] = 'test_user'
os.environ['POSTGRES_PASSWORD'] = 'test_pass'


@pytest.fixture(scope='function')
def aws_credentials():
    """Mocked AWS Credentials for moto."""
    pass

@pytest.fixture(scope='function')
def s3_mock(aws_credentials):
    """Mock S3 and create the test bucket."""
    with mock_aws():
        client = boto3.client('s3', region_name='us-east-1')
        client.create_bucket(Bucket='test-bucket')
        yield client

@pytest.fixture(scope='function')
def mock_postgres(mocker):
    """
    Mocks the PostgresClient to intercept insert_batch calls 
    and avoid requiring a real postgres DB for ETL logic tests.
    """
    mock_client = mocker.patch('src.etl.extract_load.PostgresClient')
    mock_instance = mock_client.return_value
    mock_instance.insert_batch.return_value = True
    return mock_instance
