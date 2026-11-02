process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/restaurant_manager_test?schema=public";
process.env.ACCESS_TOKEN_SECRET = "test-access-token-secret-that-is-long-enough";
process.env.REFRESH_TOKEN_PEPPER = "test-refresh-token-pepper-that-is-long-enough";
process.env.ACCESS_TOKEN_TTL_SECONDS = "900";
process.env.REFRESH_TOKEN_TTL_DAYS = "30";
process.env.BCRYPT_ROUNDS = "10";
process.env.CORS_ORIGINS = "http://localhost:8081";
