{{ config(materialized='table') }}

with order_metrics as (
    select
        customer_id,
        count(order_id) as lifetime_orders_count,
        sum(amount_usd) as lifetime_spend_usd
    from {{ ref('stg_orders') }}
    group by customer_id
)

select
    c.*,
    m.lifetime_orders_count,
    m.lifetime_spend_usd
from {{ ref('stg_customers') }} as c
left join order_metrics as m on c.customer_id = m.customer_id
