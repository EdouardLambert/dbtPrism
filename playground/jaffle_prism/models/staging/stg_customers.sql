{{ config(materialized='view') }}

select
    customer_id,
    email,
    first_name,
    last_name,
    signup_date::DATE as signup_date
from raw.customers