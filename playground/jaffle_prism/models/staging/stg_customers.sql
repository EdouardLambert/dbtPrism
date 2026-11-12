{{ config(materialized='view') }}

select
    customer_id,
    email,
    first_name,
    last_name,
    signup_date::DATE as signup_date,
    is_admin::BOOLEAN as is_admin
from raw.customers
