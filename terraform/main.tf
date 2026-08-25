terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# S3 Bucket for Raw Telemetry Logs
resource "aws_s3_bucket" "telemetry_raw" {
  bucket = var.s3_bucket_name

  tags = {
    Environment = "production"
    Project     = "aether"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "telemetry_lifecycle" {
  bucket = aws_s3_bucket.telemetry_raw.id

  rule {
    id     = "archive-old-logs"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "GLACIER"
    }
  }
}

# PostgreSQL Database (RDS) for the Data Warehouse
resource "aws_db_instance" "aether_warehouse" {
  identifier           = "aether-warehouse-db"
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = "db.t3.medium"
  allocated_storage    = 100
  storage_type         = "gp3"
  db_name              = var.db_name
  username             = var.db_username
  password             = var.db_password
  parameter_group_name = "default.postgres15"
  publicly_accessible  = false
  skip_final_snapshot  = true

  tags = {
    Environment = "production"
    Project     = "aether"
  }
}
