Analyze runtime resource dependencies and test infrastructure requirements. Focus on:
- **Database dependencies**: DB type, version, schema management tool (Flyway/Liquibase/manual), connection pool config
- **Messaging**: message queues, event buses (Kafka, RabbitMQ, ActiveMQ, etc.)
- **Caching**: Redis, Memcached, in-process caches
- **External services**: third-party APIs, payment gateways, email services, OAuth providers
- **File storage**: local filesystem assumptions, S3, NFS mounts
- **Test execution requirements**: Which dependencies require a real service to run integration tests? Which use in-memory/mock alternatives? Is Docker/Testcontainers currently used?

> ⚠️ **Document the existing infrastructure only.** Do not recommend target infrastructure choices or test strategies.

Output: `./infrastructure.md`
