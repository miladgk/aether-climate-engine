variable "aws_region" {
  description = "The AWS region to deploy resources."
  type        = string
  default     = "us-east-1"
}

variable "s3_bucket_name" {
  description = "The name of the S3 bucket for telemetry logs."
  type        = string
  default     = "aether-telemetry-raw-logs-prod"
}

variable "db_name" {
  description = "The name of the PostgreSQL database."
  type        = string
  default     = "aether_warehouse"
}

variable "db_username" {
  description = "The master username for the RDS instance."
  type        = string
  sensitive   = true
  default     = "aether_admin"
}

variable "db_password" {
  description = "The master password for the RDS instance."
  type        = string
  sensitive   = true
  default     = "SuperSecretPassword123!"
}
