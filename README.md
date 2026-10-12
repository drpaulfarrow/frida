# Frida

Frida's recipes and wardrobe. The public site lives in `site/`, the admin
pages at `/admin`, and a small Azure Functions API in `api/` stores entries
and photos in Azure Blob Storage.

## Setup (once, in the Azure portal)

1. Create a **Storage account** (Standard, LRS is fine). Under
   *Security + networking > Access keys*, copy a **Connection string**.
2. Open the **Static Web App**, go to *Settings > Environment variables*
   (called *Configuration* on older portals) and add:
   - `STORAGE_CONNECTION_STRING`: the connection string from step 1
   - `ADMIN_PASSPHRASE`: the passphrase Frida will use at `/admin`
3. Save. To change the passphrase later, edit `ADMIN_PASSPHRASE` here.

Photos and entries are kept in a private `frida` container in that storage
account, which is created automatically on first use.
