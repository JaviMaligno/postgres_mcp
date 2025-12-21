-- Create sample e-commerce schema
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INTEGER DEFAULT 0,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    status VARCHAR(20) DEFAULT 'pending',
    total_amount DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Create a view
DROP VIEW IF EXISTS customer_order_summary;
CREATE VIEW customer_order_summary AS
SELECT 
    c.id as customer_id,
    c.name as customer_name,
    c.email,
    COUNT(o.id) as total_orders,
    COALESCE(SUM(o.total_amount), 0) as total_spent
FROM customers c
LEFT JOIN orders o ON c.id = o.customer_id
GROUP BY c.id, c.name, c.email;

-- Insert sample data
INSERT INTO customers (email, name) VALUES
    ('john@example.com', 'John Doe'),
    ('jane@example.com', 'Jane Smith'),
    ('bob@example.com', 'Bob Wilson'),
    ('alice@example.com', 'Alice Brown'),
    ('charlie@example.com', 'Charlie Davis')
ON CONFLICT (email) DO NOTHING;

INSERT INTO products (name, description, price, stock_quantity, category) VALUES
    ('Laptop Pro', 'High-performance laptop for professionals', 1299.99, 50, 'Electronics'),
    ('Wireless Mouse', 'Ergonomic wireless mouse', 29.99, 200, 'Electronics'),
    ('USB-C Hub', '7-in-1 USB-C hub with HDMI', 49.99, 150, 'Electronics'),
    ('Standing Desk', 'Adjustable height standing desk', 499.99, 30, 'Furniture'),
    ('Office Chair', 'Ergonomic office chair with lumbar support', 299.99, 45, 'Furniture'),
    ('Monitor 27"', '4K IPS monitor', 399.99, 75, 'Electronics'),
    ('Keyboard Mechanical', 'RGB mechanical keyboard', 89.99, 120, 'Electronics'),
    ('Webcam HD', '1080p webcam with microphone', 59.99, 80, 'Electronics');

INSERT INTO orders (customer_id, status, total_amount, created_at) VALUES
    (1, 'completed', 1329.98, NOW() - INTERVAL '30 days'),
    (1, 'completed', 89.99, NOW() - INTERVAL '15 days'),
    (2, 'completed', 799.98, NOW() - INTERVAL '20 days'),
    (2, 'pending', 49.99, NOW() - INTERVAL '2 days'),
    (3, 'completed', 499.99, NOW() - INTERVAL '10 days'),
    (4, 'shipped', 359.98, NOW() - INTERVAL '5 days'),
    (5, 'pending', 1299.99, NOW() - INTERVAL '1 day');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 1, 1299.99),
    (1, 2, 1, 29.99),
    (2, 7, 1, 89.99),
    (3, 6, 2, 399.99),
    (4, 3, 1, 49.99),
    (5, 4, 1, 499.99),
    (6, 2, 2, 29.99),
    (6, 5, 1, 299.99),
    (7, 1, 1, 1299.99);

