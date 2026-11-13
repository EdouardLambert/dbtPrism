# dbt Prism

**dbt Prism** is a fast, fault-tolerant semantic SQL & dbt autocompletion and navigation extension for VS Code.

## Key Features

* **Rich Column Autocompletion**: Combines `schema.yml` documentation (types, descriptions, `constraints`, `data_tests`) with static SQL column inference across your dbt DAG.
* **Custom Vector Data Type Badges**: Displays color-coded SVG badges for 18 SQL data type families (`INTEGER`, `BIGINT`, `DECIMAL`, `DOUBLE`, `VARCHAR`, `UUID`, `DATE`, `TIMESTAMP`, `TIMESTAMPTZ`, `BOOLEAN`, `JSONB`, `ARRAY`, `GEOMETRY`, etc.).
* **Local CTE & `SELECT *` Lineage**: Resolves columns and metadata across chained CTEs and `SELECT * FROM {{ ref('...') }}` without requiring a compiled `manifest.json`.
* **Context-Aware SQL Suggestions**:
  * Ranks matching table aliases first, followed by qualified columns (`alias.column`) when multiple tables are joined.
  * Expands model names into `{{ ref('model') }} as model` inside `FROM` and `JOIN` clauses.
* **Multi-Hop Go to Definition (`Ctrl+Click` / `F12`)**:
  * Navigate from column usages directly to their latest explicit definition across CTEs and upstream dbt `.sql` models.
  * Navigate from table aliases to their `FROM`/`JOIN` declaration and into `{{ ref('model') }}` files.

## Extension Settings

* `dbtPrism.goToDefinition.tableTarget`:
  * `"from_alias"` *(default)*: Jump first to the table/alias declaration in the local `FROM`/`JOIN` clause, then `Ctrl+Click` the `ref()` or CTE name to open the source.
  * `"source_model"`: Jump directly to the source dbt model `.sql` file or CTE declaration.