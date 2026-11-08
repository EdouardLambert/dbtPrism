-- ============================================================================
-- DBT PRISM - VISUAL SANDBOX
-- Open only one scenario at a time (or edit directly at the indicated lines)
-- ============================================================================

with vip_orders as (
    select
        order_id,
        customer_id,
        amount_usd as net_revenue_usd
    from {{ ref('stg_orders') }}
    where amount_usd > 100
)

select
    -- [TEST 1] Type "c." below:
    -- Should suggest YAML columns (customer_id, email with descriptions)
    -- + SQL-inferred columns (first_name, last_name, signup_date with DATE type)
    -- + aggregated columns from customers.sql (lifetime_orders_count, lifetime_spend_usd)
    c.customer_id,

    -- [TEST 2] Type "v." below:
    -- Should suggest columns from the local CTE vip_orders (order_id, customer_id, net_revenue_usd)
    v.net_revenue_usd

    -- [TEST 3] On a new line above FROM, type "em" or "cust":
    -- Because there is a JOIN, typing "em" suggests and inserts "c.email" automatically!
    -- Typing "cust" suggests both "c.customer_id" and "v.customer_id"

from {{ ref('customers') }} as c
join vip_orders as v on c.customer_id = v.customer_id
-- [TEST 4] Try typing "join stg" to see model autocompletion!