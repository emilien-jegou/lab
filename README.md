# Local lab

Subject to change -- fork it 👍

```mermaid
flowchart TB
    %% =========================================================================
    %% STYLING & CLASSES
    %% =========================================================================
    classDef client fill:#eceff1,stroke:#607d8b,stroke-width:2px,color:#263238;
    classDef edge fill:#e3f2fd,stroke:#1e88e5,stroke-width:2px,color:#0d47a1;
    classDef iam fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px,color:#4a148c;
    classDef proxy fill:#fff3e0,stroke:#fb8c00,stroke-width:2px,color:#e65100;
    classDef app fill:#e8f5e9,stroke:#43a047,stroke-width:2px,color:#1b5e20;
    classDef data fill:#fbe9e7,stroke:#d84315,stroke-width:2px,color:#bf360c;

    %% =========================================================================
    %% 0. EXTERNAL CLIENT
    %% =========================================================================
    User(["🌐 Browser / Client<br>(*.localhost:8000)"]):::client

    %% =========================================================================
    %% 1. INGRESS & EDGE GATEWAY TIER
    %% =========================================================================
    subgraph EdgeTier [" 1. Ingress & Edge Layer "]
        Pingap["🔀 pingora-portal (Pingap)<br>Port: 8000 (HTTP) / 3018 (Admin)"]:::edge
    end

    User -->|"HTTP Requests (:8000)"| Pingap

    %% =========================================================================
    %% 2. IAM & AUTHENTICATION TIER
    %% =========================================================================
    subgraph IamTier [" 2. IAM & Security Plane "]
        Kanidm["🔑 kanidm (IdP)<br>Port: 8443 (HTTPS) / 3636 (LDAP)"]:::iam
        Certs["📜 kanidm-certs<br>(Self-signed generator)"]:::iam
        Certs -.->|"Mounts Certs"| Kanidm
        
        OAuth2Proxy["🛡️ unified-auth-proxy (oauth2-proxy)<br>Port: 4180 | Cookie: *.localhost"]:::proxy
    end

    %% Edge to IAM Routing
    Pingap -->|"Host: idm.localhost"| Kanidm
    Pingap -->|"Host: surrealist.localhost<br>Host: oxicloud.localhost"| OAuth2Proxy

    %% OAuth2 Proxy <-> Kanidm Backchannel
    OAuth2Proxy <-->|"OIDC Discovery & Token Exchange<br>(/oauth2/openid/unified_proxy)"| Kanidm

    %% =========================================================================
    %% 3. APPLICATION TIER
    %% =========================================================================
    subgraph AppTier [" 3. Application Tier "]
        %% Native OIDC Apps
        OpenObserve["📊 openobserve<br>Port: 5080 (Native OIDC)"]:::app
        
        %% IAP Protected Apps
        Surrealist["💻 surrealist (Web UI)<br>Port: 8080 (Protected)"]:::app
        Oxicloud["☁️ oxicloud (Files)<br>Port: 8086 (Protected)"]:::app

        %% Custom / Internal Apps
        LabApp["🧪 lab (Bun App)<br>Port: 3000 / 6605"]:::app
        ImgProxy["🖼️ imgproxy<br>Port: 8080"]:::app
    end

    %% Direct Routes through Pingap
    Pingap -->|"Host: openobserve.localhost"| OpenObserve
    Pingap -->|"Host: lab.localhost"| LabApp

    %% Direct OIDC Flow for Native Apps
    OpenObserve <-->|"Direct OIDC SSO Flow<br>(Client Secret / Tokens)"| Kanidm

    %% Protected Upstream Routing from oauth2-proxy
    OAuth2Proxy -->|"Authenticated Upstream"| Surrealist
    OAuth2Proxy -->|"Authenticated Upstream"| Oxicloud

    %% =========================================================================
    %% 4. DATA, TELEMETRY & STORAGE PLANE (INTERNAL)
    %% =========================================================================
    subgraph DataTier [" 4. Data, Message & Telemetry Plane (Internal) "]
        SurrealDB[("🗄️ surrealdb<br>Port: 6800 / 8200")]:::data
        OxicloudDB[("🐘 oxicloud-db (Postgres)<br>Port: 5432")]:::data
        Garage[("📦 garage (S3 Object Store)<br>Port: 3900 / 3902")]:::data
        Valkey[("⚡ valkey (Redis Cache)<br>Port: 6379")]:::data
        Iggy[("📨 iggy (Message Stream)<br>Port: 3000 / 8090")]:::data
        Vector["🚚 vector (Telemetry Shipper)<br>Port: 8686 / 4317"]:::data
    end

    %% Service-to-Service Connections
    Surrealist -->|"WebSocket / SQL Queries"| SurrealDB
    Oxicloud -->|"SQL"| OxicloudDB
    Oxicloud -->|"S3 API"| Garage
    ImgProxy -->|"Fetch Images"| Garage

    LabApp --> SurrealDB
    LabApp --> Valkey
    LabApp --> Iggy
    LabApp --> Garage
    LabApp --> Oxicloud
    LabApp --> ImgProxy

    %% Telemetry pipeline
    Vector -->|"Ingest Logs & Metrics"| OpenObserve
    LabApp -.->|"Logs / Spans"| Vector

    %% Optional JWKS Bearer Token Verification
    Kanidm -.->|"JWKS Public Keys for Token Validation"| SurrealDB
```

## Project Overview

This Lab Starter comes with the following:
[FILL THIS]

## Dependencies

Check the [shell.nix](./shell.nix) file.

## Setup

0. Install the packages requirements via `devenv.nix` file.
```sh
direnv allow .
```

1. Copy over the env folder
```sh
cp -r env.example env
```

Modify secrets or run with default (for local use), e.g.:
*   **`env/lab.env`**:
    *   `LAB_OPENOBSERVE_PASSWORD`

3. Launch it
```sh
docker-compose up --build
```

4. While the services are running, generate the master IAM password

```sh
lab-idm-gen-admin-pass
# or without devenv:
# docker compose exec -it kanidm kanidmd recover-account -c /etc/kanidm/server.toml admin
```

This should produce the following output:
```
ｉ [info]: Starting Kanidmd | version: 1.11.2
ｉ [info]: Running account recovery ...
ｉ [info]:  | new_password: "p8j*********************************************"
```

5. Login to the IDM at `http://idm.localhost:8000` using your newly generated password.

```yaml
username: admin
password: generated in step 4.
```

Login in the IAM will automatically connect you to all of the app services via the OCIP protocol.

6. You now have access to all services via localhost:8000

This setup will provide expose the following web application:
*   **Surrealist**: **http://surrealist.localhost:8000**
*   **Openobserve**: **http://openobserve.localhost:8000**
*   **Oxicloud**: **http://oxicloud.localhost:8000**

And open up thoses API urls:
*   **Lab**: **http://lab.localhost:8000**
*   **Imgproxy**: **http://imgproxy.localhost:8000**

## More information on current development

I am currently focus in adding workflow automation and client side UI for the lab and workflow visualization. The current auth setup (IAM + proxy) is too flimsy for production as is.
