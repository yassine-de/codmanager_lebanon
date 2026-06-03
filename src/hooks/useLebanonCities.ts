import { useQuery } from "@tanstack/react-query";
import lebanonCitiesText from "@/assets/lebanon-cities.txt?raw";
import { supabase } from "@/integrations/supabase/client";

export interface LebanonCity {
  city_id: number;
  city_name: string;
  province_id: number | null;
}

const fallbackCities: LebanonCity[] = lebanonCitiesText
  .split(/\r?\n/)
  .map((city) => city.trim())
  .filter(Boolean)
  .map((city_name, index) => ({
    city_id: index + 1,
    city_name,
    province_id: null,
  }));

export function useLebanonCities() {
  return useQuery({
    queryKey: ["wakilni-areas"],
    queryFn: async () => {
      const allCities: LebanonCity[] = [];
      const batchSize = 1000;
      let from = 0;

      while (true) {
        const { data, error } = await (supabase as any)
          .from("wakilni_areas_cache")
          .select("area_id, area_name, parent_id")
          .order("area_name")
          .range(from, from + batchSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allCities.push(
          ...data.map((area: any) => ({
            city_id: area.area_id,
            city_name: area.area_name,
            province_id: area.parent_id,
          }))
        );

        if (data.length < batchSize) break;
        from += batchSize;
      }

      return allCities.length > 0 ? allCities : fallbackCities;
    },
    initialData: fallbackCities,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
