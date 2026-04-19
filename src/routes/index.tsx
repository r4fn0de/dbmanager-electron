import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Database, Plus, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConnections } from "@/hooks/useConnections";
import { ConnectionTabs } from "@/components/ConnectionTabs";

function HomePage() {
  const { t } = useTranslation();
  const { connections, isLoading, error } = useConnections();

  return (
    <div className="flex h-full flex-col">
      {/* Connection Tabs */}
      <div className="border-b bg-muted/30">
        <ConnectionTabs />
      </div>

      <div className="flex-1 p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{t("appName")}</h1>
              <p className="text-muted-foreground mt-1">
                Manage your database connections
              </p>
            </div>
            <Button asChild>
              <Link to="/">
                <Plus className="mr-2 h-4 w-4" />
                New Connection
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              Loading connections...
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-500">
              Error: {error}
            </div>
          ) : connections.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <Database className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No connections yet</h3>
                <p className="text-muted-foreground mb-4">
                  Add your first database connection to get started.
                </p>
                <Button asChild>
                  <Link to="/">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Connection
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {connections.map((conn) => (
                <Card key={conn.id} className="hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">{conn.name}</CardTitle>
                    </div>
                    <CardDescription>
                      {conn.host}:{conn.port}/{conn.database}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="secondary" size="sm" className="w-full" asChild>
                      <Link
                        to="/database/$connectionId"
                        params={{ connectionId: conn.id }}
                      >
                        Connect
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
