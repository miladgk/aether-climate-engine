import os
import boto3
import json
import logging
from typing import Generator, Dict, Any

logger = logging.getLogger(__name__)

class S3Client:
    def __init__(self, bucket_name: str):
        """
        Initializes the S3Client with boto3 session.
        Credentials should be picked up from the environment variables by boto3.
        """
        self.bucket_name = bucket_name
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1')
        )

    def stream_json_lines(self, prefix: str) -> Generator[Dict[str, Any], None, None]:
        """
        Paginates through the specified bucket to locate the target daily log files.
        Streams the file content line by line as JSON objects to avoid loading
        entire large files into memory.
        """
        paginator = self.s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=self.bucket_name, Prefix=prefix)

        for page in pages:
            if 'Contents' not in page:
                continue
            
            for obj in page['Contents']:
                key = obj['Key']
                if not key.endswith('.json') and not key.endswith('.jsonl'):
                    continue
                
                logger.info(f"Streaming file: {key}")
                response = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
                streaming_body = response['Body']
                
                for line in streaming_body.iter_lines():
                    if line:
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError as e:
                            logger.warning(f"Malformed JSON in file {key}: {e}. Routing to DLQ.")
                            with open("dead_letter_queue.dlq", "a") as dlq:
                                dlq.write(line.decode('utf-8') + '\n')
                            continue
