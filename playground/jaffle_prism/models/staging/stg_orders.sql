{{ config(materialized='view') }}

select
    order_id,
    customer_id,
    order_status,
    amount_cents / 100.0 as amount_usd,
    ordered_at
from raw.orders