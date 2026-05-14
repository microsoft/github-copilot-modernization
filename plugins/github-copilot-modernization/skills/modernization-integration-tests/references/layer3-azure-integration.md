# Layer 3: Azure Integration Tests

**Goal:** "Does it work in real cloud environment?"

Deploy to Azure staging environment and test against real Azure services.

## Test Isolation

- **DO use `L3Test` as the class name suffix** for all Layer 3 test classes (e.g., `AzureSqlL3Test`, `BlobStorageL3Test`). The `*Test` suffix matches Maven Surefire's default discovery pattern — no build plugin changes needed.
- **DO annotate every test class with a `Layer3` tag/category** so runner scripts filter precisely and never trigger Layer 1, 2, or 4 tests. See the Test Isolation Convention in the main skill file for the exact annotation per language/framework.
- The runner script **MUST filter by the `Layer3` tag** (e.g., `mvn verify -Dgroups=Layer3`, `dotnet test --filter Category=Layer3`, `pytest -m layer3`)

## Prerequisites

- Azure subscription with staging environment
- Azure CLI installed and authenticated
- Infrastructure-as-Code templates (Bicep/ARM/Terraform)

## Workflow

### 1. Identify Azure Services

Map application dependencies to Azure services:

| Local Dependency | Azure Service | Configuration Needed |
|-----------------|---------------|---------------------|
| SQL Server | Azure SQL Database | Connection string, firewall |
| PostgreSQL | Azure Database for PostgreSQL | Connection string, SSL |
| Redis | Azure Cache for Redis | Connection string, access key |
| File storage | Azure Blob Storage | Connection string, container |
| Message queue | Azure Service Bus | Connection string, queue |
| Key vault | Azure Key Vault | Managed identity, access policy |
| Logging | Application Insights | Instrumentation key |

### 2. Deploy to Staging

#### Using Azure CLI

```bash
# Set variables
RESOURCE_GROUP="rg-app-staging"
LOCATION="eastus"
APP_NAME="app-integration-test-$(date +%s)"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Deploy infrastructure
az deployment group create \
    --resource-group $RESOURCE_GROUP \
    --template-file infra/main.bicep \
    --parameters environment=staging

# Deploy application
az webapp deploy \
    --resource-group $RESOURCE_GROUP \
    --name $APP_NAME \
    --src-path ./publish.zip
```

#### Using GitHub Actions

```yaml
- name: Deploy to Staging
  uses: azure/webapps-deploy@v2
  with:
    app-name: ${{ env.APP_NAME }}
    slot-name: staging
    package: ./publish.zip
```

### 3. Configure Azure Services

```bash
# Get connection strings from deployed resources
SQL_CONN=$(az sql db show-connection-string \
    --server $SQL_SERVER \
    --name $DB_NAME \
    --client ado.net)

REDIS_CONN=$(az redis list-keys \
    --resource-group $RESOURCE_GROUP \
    --name $REDIS_NAME \
    --query primaryKey -o tsv)

STORAGE_CONN=$(az storage account show-connection-string \
    --resource-group $RESOURCE_GROUP \
    --name $STORAGE_NAME \
    --query connectionString -o tsv)

# Update app settings
az webapp config appsettings set \
    --resource-group $RESOURCE_GROUP \
    --name $APP_NAME \
    --settings \
        "ConnectionStrings__Default=$SQL_CONN" \
        "Redis__ConnectionString=$REDIS_CONN" \
        "Storage__ConnectionString=$STORAGE_CONN"
```

### 4. Run Integration Tests Against Staging

```bash
# Set test target to staging URL
export TEST_BASE_URL="https://$APP_NAME.azurewebsites.net"

# Run Layer 3 integration tests only (filter by Layer3 tag)
dotnet test --filter Category=Layer3
```

Test scenario areas for Azure (all tagged with `Layer3`):

| Scenario Area | Tests |
|----------|-------|
| Database | CRUD operations, transactions, stored procedures |
| Storage | Blob upload/download, container operations |
| Cache | Get/set, expiration, distributed locks |
| Messaging | Send/receive, dead letter, retry |
| Identity | Authentication, authorization, managed identity |

### 5. Validate Azure-Specific Features

```csharp
[Trait("Category", "Layer3")]
public class AzureSqlL3Test
{
    [Fact]
    public async Task CanConnectToAzureSql()
    {
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        conn.State.Should().Be(ConnectionState.Open);
    }

    [Fact]
    public async Task TransactionWorksAcrossMultipleTables()
    {
        // Test Azure SQL transaction behavior
    }
}

[Trait("Category", "Layer3")]
public class AzureBlobL3Test
{
    [Fact]
    public async Task CanUploadAndDownloadBlob()
    {
        var container = _blobClient.GetBlobContainerClient("test");
        await container.CreateIfNotExistsAsync();

        var blob = container.GetBlobClient("test.txt");
        await blob.UploadAsync(new BinaryData("test content"));

        var downloaded = await blob.DownloadContentAsync();
        downloaded.Value.Content.ToString().Should().Be("test content");
    }
}
```

### 6. Collect Metrics and Logs

```bash
# Get Application Insights logs
az monitor app-insights query \
    --app $APP_INSIGHTS_NAME \
    --analytics-query "traces | where timestamp > ago(1h) | order by timestamp desc | take 100"

# Check for errors
az monitor app-insights query \
    --app $APP_INSIGHTS_NAME \
    --analytics-query "exceptions | where timestamp > ago(1h)"

# Get performance metrics
az monitor metrics list \
    --resource $APP_RESOURCE_ID \
    --metric "Requests,AverageResponseTime,Http5xx"
```

### 7. Cleanup

```bash
# Delete staging resources
az group delete --name $RESOURCE_GROUP --yes --no-wait
```

## Pass Criteria

- Application deploys successfully to Azure
- All Azure service connections work
- Integration tests pass against real services
- No 5xx errors in Application Insights
- Performance is within acceptable thresholds
- Logs show no critical errors
- Runner scripts generated per the Standardized Runner Scripts convention in the main skill file
