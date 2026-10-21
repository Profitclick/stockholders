export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      business_raw: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          employees: number | null
          id: string
          import_job_id: string | null
          industry: string | null
          metadata: Json | null
          municipality: string | null
          name: string | null
          orgnr: string | null
          phone: string | null
          region: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          employees?: number | null
          id?: string
          import_job_id?: string | null
          industry?: string | null
          metadata?: Json | null
          municipality?: string | null
          name?: string | null
          orgnr?: string | null
          phone?: string | null
          region?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          employees?: number | null
          id?: string
          import_job_id?: string | null
          industry?: string | null
          metadata?: Json | null
          municipality?: string | null
          name?: string | null
          orgnr?: string | null
          phone?: string | null
          region?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_raw_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          brreg_data: Json | null
          created_at: string
          datanorge_context: Json | null
          email: string | null
          enriched: boolean
          eu_context: Json | null
          geo_context: Json | null
          id: string
          industry: string | null
          investor_count: number | null
          name: string
          orgnr: string
          phone: string | null
          shareholder_count: number | null
          size: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          brreg_data?: Json | null
          created_at?: string
          datanorge_context?: Json | null
          email?: string | null
          enriched?: boolean
          eu_context?: Json | null
          geo_context?: Json | null
          id?: string
          industry?: string | null
          investor_count?: number | null
          name: string
          orgnr: string
          phone?: string | null
          shareholder_count?: number | null
          size?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          brreg_data?: Json | null
          created_at?: string
          datanorge_context?: Json | null
          email?: string | null
          enriched?: boolean
          eu_context?: Json | null
          geo_context?: Json | null
          id?: string
          industry?: string | null
          investor_count?: number | null
          name?: string
          orgnr?: string
          phone?: string | null
          shareholder_count?: number | null
          size?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      company_signals: {
        Row: {
          board_size: number | null
          ceo_name: string | null
          chair_name: string | null
          company_age_years: number | null
          contract_count: number
          contract_value: number
          email: string | null
          equity: number | null
          eu_grants_count: number
          founded_date: string | null
          grants_count: number
          has_capital_increase: boolean
          has_majority_change: boolean
          has_new_shareholder: boolean
          industry: string | null
          ip_rights_count: number
          lead_score: number
          municipality: string | null
          municipality_no: string | null
          nace_code: string | null
          nace_prefix: string | null
          name: string
          open_jobs_count: number
          operating_profit: number | null
          org_form: string | null
          orgnr: string
          phone: string | null
          postcode: string | null
          profit_margin: number | null
          research_council_count: number
          revenue: number | null
          skattefunn_count: number
          total_debt: number | null
          trigger_count: number
          updated_at: string
          website: string | null
        }
        Insert: {
          board_size?: number | null
          ceo_name?: string | null
          chair_name?: string | null
          company_age_years?: number | null
          contract_count?: number
          contract_value?: number
          email?: string | null
          equity?: number | null
          eu_grants_count?: number
          founded_date?: string | null
          grants_count?: number
          has_capital_increase?: boolean
          has_majority_change?: boolean
          has_new_shareholder?: boolean
          industry?: string | null
          ip_rights_count?: number
          lead_score?: number
          municipality?: string | null
          municipality_no?: string | null
          nace_code?: string | null
          nace_prefix?: string | null
          name: string
          open_jobs_count?: number
          operating_profit?: number | null
          org_form?: string | null
          orgnr: string
          phone?: string | null
          postcode?: string | null
          profit_margin?: number | null
          research_council_count?: number
          revenue?: number | null
          skattefunn_count?: number
          total_debt?: number | null
          trigger_count?: number
          updated_at?: string
          website?: string | null
        }
        Update: {
          board_size?: number | null
          ceo_name?: string | null
          chair_name?: string | null
          company_age_years?: number | null
          contract_count?: number
          contract_value?: number
          email?: string | null
          equity?: number | null
          eu_grants_count?: number
          founded_date?: string | null
          grants_count?: number
          has_capital_increase?: boolean
          has_majority_change?: boolean
          has_new_shareholder?: boolean
          industry?: string | null
          ip_rights_count?: number
          lead_score?: number
          municipality?: string | null
          municipality_no?: string | null
          nace_code?: string | null
          nace_prefix?: string | null
          name?: string
          open_jobs_count?: number
          operating_profit?: number | null
          org_form?: string | null
          orgnr?: string
          phone?: string | null
          postcode?: string | null
          profit_margin?: number | null
          research_council_count?: number
          revenue?: number | null
          skattefunn_count?: number
          total_debt?: number | null
          trigger_count?: number
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      contract_awards: {
        Row: {
          awarded_name: string | null
          awarded_name_norm: string | null
          buyer_name: string | null
          buyer_orgnr: string | null
          cpv_codes: Json | null
          created_at: string
          currency: string | null
          doffin_url: string | null
          estimated_value: number | null
          heading: string | null
          id: string
          matched_orgnr: string | null
          notice_id: string
          publication_date: string | null
        }
        Insert: {
          awarded_name?: string | null
          awarded_name_norm?: string | null
          buyer_name?: string | null
          buyer_orgnr?: string | null
          cpv_codes?: Json | null
          created_at?: string
          currency?: string | null
          doffin_url?: string | null
          estimated_value?: number | null
          heading?: string | null
          id?: string
          matched_orgnr?: string | null
          notice_id: string
          publication_date?: string | null
        }
        Update: {
          awarded_name?: string | null
          awarded_name_norm?: string | null
          buyer_name?: string | null
          buyer_orgnr?: string | null
          cpv_codes?: Json | null
          created_at?: string
          currency?: string | null
          doffin_url?: string | null
          estimated_value?: number | null
          heading?: string | null
          id?: string
          matched_orgnr?: string | null
          notice_id?: string
          publication_date?: string | null
        }
        Relationships: []
      }
      exports_archive: {
        Row: {
          created_at: string
          file_path: string | null
          format: string
          id: string
          metadata: Json | null
          profile_id: string | null
          row_count: number
          segment_id: string | null
        }
        Insert: {
          created_at?: string
          file_path?: string | null
          format?: string
          id?: string
          metadata?: Json | null
          profile_id?: string | null
          row_count?: number
          segment_id?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string | null
          format?: string
          id?: string
          metadata?: Json | null
          profile_id?: string | null
          row_count?: number
          segment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exports_archive_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_archive_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_triggers: {
        Row: {
          created_at: string
          id: string
          investor_id: string | null
          metadata: Json | null
          orgnr: string | null
          trigger_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          investor_id?: string | null
          metadata?: Json | null
          orgnr?: string | null
          trigger_type: string
        }
        Update: {
          created_at?: string
          id?: string
          investor_id?: string | null
          metadata?: Json | null
          orgnr?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_triggers_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      investors: {
        Row: {
          birth_year: number | null
          brreg_context: Json | null
          capital_estimate: number | null
          capital_score: number | null
          created_at: string
          custom_scores: Json | null
          demographics: Json | null
          gender: string | null
          ias_score: number | null
          id: string
          municipality: string | null
          name: string
          portfolio_companies: Json | null
          portfolio_industries: Json | null
          portfolio_size: number
          region: string | null
          risk_score: number | null
          sector_score: number | null
          ssb_context: Json | null
          type: string | null
          updated_at: string
          velocity_score: number | null
          yoy_changes: Json | null
        }
        Insert: {
          birth_year?: number | null
          brreg_context?: Json | null
          capital_estimate?: number | null
          capital_score?: number | null
          created_at?: string
          custom_scores?: Json | null
          demographics?: Json | null
          gender?: string | null
          ias_score?: number | null
          id?: string
          municipality?: string | null
          name: string
          portfolio_companies?: Json | null
          portfolio_industries?: Json | null
          portfolio_size?: number
          region?: string | null
          risk_score?: number | null
          sector_score?: number | null
          ssb_context?: Json | null
          type?: string | null
          updated_at?: string
          velocity_score?: number | null
          yoy_changes?: Json | null
        }
        Update: {
          birth_year?: number | null
          brreg_context?: Json | null
          capital_estimate?: number | null
          capital_score?: number | null
          created_at?: string
          custom_scores?: Json | null
          demographics?: Json | null
          gender?: string | null
          ias_score?: number | null
          id?: string
          municipality?: string | null
          name?: string
          portfolio_companies?: Json | null
          portfolio_industries?: Json | null
          portfolio_size?: number
          region?: string | null
          risk_score?: number | null
          sector_score?: number | null
          ssb_context?: Json | null
          type?: string | null
          updated_at?: string
          velocity_score?: number | null
          yoy_changes?: Json | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          created_at: string
          current_batch: number
          errors_count: number
          estimated_time_remaining: number | null
          id: string
          metadata: Json | null
          progress: number
          status: Database["public"]["Enums"]["job_status"]
          total_batches: number
          type: string
          updated_at: string
          warnings_count: number
        }
        Insert: {
          created_at?: string
          current_batch?: number
          errors_count?: number
          estimated_time_remaining?: number | null
          id?: string
          metadata?: Json | null
          progress?: number
          status?: Database["public"]["Enums"]["job_status"]
          total_batches?: number
          type: string
          updated_at?: string
          warnings_count?: number
        }
        Update: {
          created_at?: string
          current_batch?: number
          errors_count?: number
          estimated_time_remaining?: number | null
          id?: string
          metadata?: Json | null
          progress?: number
          status?: Database["public"]["Enums"]["job_status"]
          total_batches?: number
          type?: string
          updated_at?: string
          warnings_count?: number
        }
        Relationships: []
      }
      parquet_imports: {
        Row: {
          created_at: string
          filename: string
          id: string
          row_count: number | null
          schema: Json | null
          status: string | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          row_count?: number | null
          schema?: Json | null
          status?: string | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          row_count?: number | null
          schema?: Json | null
          status?: string | null
          storage_path?: string | null
        }
        Relationships: []
      }
      person_holdings: {
        Row: {
          birth_year: number | null
          change_type: string
          company: string | null
          id: number
          orgnr: string
          pct_2024: number | null
          pct_2025: number | null
          postal: string | null
          shareholder_name: string
          shares_2024: number | null
          shares_2025: number | null
        }
        Insert: {
          birth_year?: number | null
          change_type?: string
          company?: string | null
          id?: number
          orgnr: string
          pct_2024?: number | null
          pct_2025?: number | null
          postal?: string | null
          shareholder_name: string
          shares_2024?: number | null
          shares_2025?: number | null
        }
        Update: {
          birth_year?: number | null
          change_type?: string
          company?: string | null
          id?: number
          orgnr?: string
          pct_2024?: number | null
          pct_2025?: number | null
          postal?: string | null
          shareholder_name?: string
          shares_2024?: number | null
          shares_2025?: number | null
        }
        Relationships: []
      }
      pipeline_stats: {
        Row: {
          key: string
          updated_at: string
          value: number
        }
        Insert: {
          key: string
          updated_at?: string
          value?: number
        }
        Update: {
          key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      plugin_data: {
        Row: {
          created_at: string
          id: string
          orgnr: string | null
          plugin_id: string
          row_data: Json
        }
        Insert: {
          created_at?: string
          id?: string
          orgnr?: string | null
          plugin_id: string
          row_data?: Json
        }
        Update: {
          created_at?: string
          id?: string
          orgnr?: string | null
          plugin_id?: string
          row_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "plugin_data_plugin_id_fkey"
            columns: ["plugin_id"]
            isOneToOne: false
            referencedRelation: "plugins"
            referencedColumns: ["id"]
          },
        ]
      }
      plugin_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          plugin_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          plugin_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          plugin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plugin_logs_plugin_id_fkey"
            columns: ["plugin_id"]
            isOneToOne: false
            referencedRelation: "plugins"
            referencedColumns: ["id"]
          },
        ]
      }
      plugins: {
        Row: {
          config: Json | null
          created_at: string
          dataset_type: string | null
          description: string | null
          enabled: boolean
          id: string
          name: string
          row_count: number
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          dataset_type?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          name: string
          row_count?: number
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          dataset_type?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          name?: string
          row_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_prebuilt: boolean
          name: string
          rules: Json | null
          thresholds: Json | null
          updated_at: string
          weights: Json | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_prebuilt?: boolean
          name: string
          rules?: Json | null
          thresholds?: Json | null
          updated_at?: string
          weights?: Json | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_prebuilt?: boolean
          name?: string
          rules?: Json | null
          thresholds?: Json | null
          updated_at?: string
          weights?: Json | null
        }
        Relationships: []
      }
      segments: {
        Row: {
          created_at: string
          id: string
          investor_ids: Json | null
          profile_id: string | null
          summary: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          investor_ids?: Json | null
          profile_id?: string | null
          summary?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          investor_ids?: Json | null
          profile_id?: string | null
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "segments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shareholder_raw: {
        Row: {
          as_of_year: number | null
          birth_year: number | null
          company_name: string | null
          created_at: string
          dataset_type: Database["public"]["Enums"]["dataset_type"]
          gender: string | null
          id: string
          import_job_id: string | null
          municipality: string | null
          orgnr: string | null
          postcode: string | null
          shareholder_name: string | null
          shareholder_type: string | null
          shares: number | null
          year: number | null
        }
        Insert: {
          as_of_year?: number | null
          birth_year?: number | null
          company_name?: string | null
          created_at?: string
          dataset_type?: Database["public"]["Enums"]["dataset_type"]
          gender?: string | null
          id?: string
          import_job_id?: string | null
          municipality?: string | null
          orgnr?: string | null
          postcode?: string | null
          shareholder_name?: string | null
          shareholder_type?: string | null
          shares?: number | null
          year?: number | null
        }
        Update: {
          as_of_year?: number | null
          birth_year?: number | null
          company_name?: string | null
          created_at?: string
          dataset_type?: Database["public"]["Enums"]["dataset_type"]
          gender?: string | null
          id?: string
          import_job_id?: string | null
          municipality?: string | null
          orgnr?: string | null
          postcode?: string | null
          shareholder_name?: string | null
          shareholder_type?: string | null
          shares?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shareholder_raw_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aggregate_companies:
        | { Args: { p_after_orgnr?: string; p_limit?: number }; Returns: Json }
        | { Args: { p_limit?: number; p_offset?: number }; Returns: number }
      aggregate_investors:
        | { Args: { p_after_name?: string; p_limit?: number }; Returns: Json }
        | { Args: { p_limit?: number; p_offset?: number }; Returns: number }
      bulk_score_investors: { Args: { p_weights?: Json }; Returns: Json }
      cleanup_shareholder_data: { Args: { p_limit?: number }; Returns: Json }
      cross_reference_plugin: { Args: { p_plugin_id: string }; Returns: Json }
      detect_yoy_triggers: { Args: { p_limit?: number }; Returns: Json }
      generate_lookalike_segment: {
        Args: { p_limit?: number; p_seed_profile: Json }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      jsonb_arr: { Args: { j: Json }; Returns: Json }
      jsonb_obj: { Args: { j: Json }; Returns: Json }
      jsonb_object_keys_count: { Args: { j: Json }; Returns: number }
      normalize_company_name: { Args: { p_name: string }; Returns: string }
      refresh_company_signals: { Args: never; Returns: Json }
      refresh_pipeline_stats: { Args: never; Returns: undefined }
      safe_date: { Args: { t: string }; Returns: string }
      safe_numeric: { Args: { t: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
      dataset_type:
        | "shareholder"
        | "price"
        | "crypto"
        | "crm"
        | "sector"
        | "demographic"
        | "plugin"
        | "business"
      job_status: "queued" | "running" | "completed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      dataset_type: [
        "shareholder",
        "price",
        "crypto",
        "crm",
        "sector",
        "demographic",
        "plugin",
        "business",
      ],
      job_status: ["queued", "running", "completed", "failed"],
    },
  },
} as const
