import { PlainClientAPI } from 'contentful-management';

export interface EnvironmentWithAlias {
  sys: { id: string };
  name: string;
  displayName: string; // "alias → name" or just "name"
  aliasedBy?: string[]; // List of aliases pointing to this environment
}

/**
 * Fetches environments and their aliases, returning a combined list with display names
 */
export async function getEnvironmentsWithAliases(
  cma: PlainClientAPI,
  spaceId: string
): Promise<EnvironmentWithAlias[]> {
  try {
    // Fetch environments
    const envs = await cma.environment.getMany({ spaceId });
    
    // Fetch aliases
    let aliases: any[] = [];
    try {
      const aliasResponse = await cma.environmentAlias.getMany({ spaceId });
      aliases = aliasResponse.items;
      if (aliases.length > 0) {
      }
    } catch (err) {
      console.warn('[EnvironmentHelpers] Failed to fetch aliases:', err);
      // Continue without aliases if API fails
    }
    
    // Create a map of environment ID to list of aliases
    const envToAliases = new Map<string, string[]>();
    aliases.forEach((alias) => {
      // Try different possible paths for the target environment ID
      let targetEnvId = alias.environment?.sys?.id;
      
      // If not found, try alternative paths
      if (!targetEnvId) {
        targetEnvId = (alias as any).environmentId;
      }
      if (!targetEnvId && alias.environment) {
        // Try accessing as a Link object
        targetEnvId = (alias.environment as any).id;
      }
      
      
      if (targetEnvId) {
        if (!envToAliases.has(targetEnvId)) {
          envToAliases.set(targetEnvId, []);
        }
        envToAliases.get(targetEnvId)!.push(alias.sys.id);
      } else {
        console.warn('[EnvironmentHelpers] Could not determine target environment for alias:', alias.sys.id);
      }
    });
    
    
    // Create a set of environment IDs that have aliases pointing to them
    // These should be filtered out (we'll show them via their alias instead)
    const aliasedEnvIds = new Set(envToAliases.keys());
    
    
    // Debug: Check if "main" is actually in the Set
    
    // Create enriched environment objects - ONLY for environments WITHOUT aliases
    const enrichedEnvs: EnvironmentWithAlias[] = envs.items
      .filter((env) => {
        const hasAlias = aliasedEnvIds.has(env.sys.id);
        if (hasAlias) {
          return false; // Explicitly return false
        }
        return true; // Explicitly return true
      })
      .map((env) => {
        // These environments don't have aliases, so show them normally
        return {
          sys: env.sys,
          name: env.name || env.sys.id,
          displayName: env.name || env.sys.id,
          aliasedBy: undefined,
        };
      });
    
    
    // Now add entries for aliased environments (showing them via their alias)
    aliases.forEach((alias) => {
      // Use the same logic as above to get target environment ID
      let targetEnvId = alias.environment?.sys?.id;
      if (!targetEnvId) {
        targetEnvId = (alias as any).environmentId;
      }
      if (!targetEnvId && alias.environment) {
        targetEnvId = (alias.environment as any).id;
      }
      
      if (targetEnvId) {
        const targetEnv = envs.items.find((e) => e.sys.id === targetEnvId);
        if (targetEnv) {
          // Double-check: Make sure this environment was filtered out
          if (aliasedEnvIds.has(targetEnvId)) {
            // Create an entry for the alias pointing to this environment
            const aliasEntry = {
              sys: { id: targetEnvId }, // Keep the actual environment ID for operations
              name: targetEnv.name || targetEnvId,
              displayName: `${alias.sys.id} → ${targetEnv.name || targetEnvId}`,
              aliasedBy: [alias.sys.id],
            };
            enrichedEnvs.push(aliasEntry);
          } else {
            console.warn(`[EnvironmentHelpers] Skipping alias ${alias.sys.id} - target env ${targetEnvId} was not filtered out (should not happen)`);
          }
        } else {
          console.warn(`[EnvironmentHelpers] Could not find target environment ${targetEnvId} for alias ${alias.sys.id}`);
        }
      } else {
        console.warn(`[EnvironmentHelpers] Could not determine target environment for alias ${alias.sys.id}`);
      }
    });
    
    // Deduplicate by sys.id, prioritizing alias entries over non-alias entries
    const envMap = new Map<string, EnvironmentWithAlias>();
    enrichedEnvs.forEach((env) => {
      const existing = envMap.get(env.sys.id);
      if (!existing) {
        envMap.set(env.sys.id, env);
      } else {
        // If we have both an alias entry and a non-alias entry, prefer the alias entry
        if (env.aliasedBy && !existing.aliasedBy) {
          envMap.set(env.sys.id, env);
        } else if (!env.aliasedBy && existing.aliasedBy) {
        } else {
        }
      }
    });
    let deduplicatedEnvs = Array.from(envMap.values());
    
    // Final safety check: Remove any environments that have alias entries but also appear directly
    // This handles cases where the alias detection might have failed
    
    const envsWithAliases = new Set<string>();
    deduplicatedEnvs.forEach(env => {
      if (env.aliasedBy && env.aliasedBy.length > 0) {
        envsWithAliases.add(env.sys.id);
      }
    });
    
    
    // Filter out direct entries for environments that have alias entries
    const beforeFilter = deduplicatedEnvs.length;
    deduplicatedEnvs = deduplicatedEnvs.filter(env => {
      const hasAliasEntry = envsWithAliases.has(env.sys.id);
      const isAliasEntry = env.aliasedBy && env.aliasedBy.length > 0;
      // Keep if: no aliases exist for this env, OR this IS the alias entry
      const shouldKeep = !hasAliasEntry || isAliasEntry;
      
      
      if (!shouldKeep) {
      }
      return shouldKeep;
    });
    
    if (deduplicatedEnvs.length < beforeFilter) {
    } else {
    }
    
    // Sort by display name for consistent ordering
    deduplicatedEnvs.sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    
    return deduplicatedEnvs;
  } catch (err) {
    console.error('[EnvironmentHelpers] Failed to fetch environments:', err);
    throw err;
  }
}

/**
 * Gets a human-readable display name for an environment ID
 */
export function getEnvironmentDisplayName(
  envId: string,
  environments: EnvironmentWithAlias[]
): string {
  const env = environments.find((e) => e.sys.id === envId);
  return env?.displayName || envId;
}

