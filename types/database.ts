// GERADO AUTOMATICAMENTE — NÃO EDITE À MÃO.
// Regenere com: npm run db:types (veja ops/README-shadow-db.md).
// A fonte é o schema materializado a partir de supabase/migrations.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      clients: {
        Row: {
          address: string | null
          birth_date: string | null
          city: string | null
          company_id: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          identity_document: string | null
          marital_status: string | null
          name: string
          nationality: string | null
          notes: string | null
          person_type: string
          phone: string | null
          postal_code: string | null
          profession: string | null
          secondary_phone: string | null
          source_id: string | null
          source_system: string | null
          state: string | null
          status: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          city?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          identity_document?: string | null
          marital_status?: string | null
          name: string
          nationality?: string | null
          notes?: string | null
          person_type?: string
          phone?: string | null
          postal_code?: string | null
          profession?: string | null
          secondary_phone?: string | null
          source_id?: string | null
          source_system?: string | null
          state?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          city?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          identity_document?: string | null
          marital_status?: string | null
          name?: string
          nationality?: string | null
          notes?: string | null
          person_type?: string
          phone?: string | null
          postal_code?: string | null
          profession?: string | null
          secondary_phone?: string | null
          source_id?: string | null
          source_system?: string | null
          state?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_brokers: {
        Row: {
          agency_name: string | null
          bank_account: string | null
          bank_agency: string | null
          bank_name: string | null
          company_id: string
          created_at: string
          created_by: string | null
          creci_number: string | null
          creci_state: string | null
          default_commission_pct: number
          email: string | null
          id: string
          kind: string
          legal_name: string | null
          name: string
          notes: string | null
          payment_due_days: number
          phone: string | null
          pix_key: string | null
          status: string
          supplier_id: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          agency_name?: string | null
          bank_account?: string | null
          bank_agency?: string | null
          bank_name?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          creci_number?: string | null
          creci_state?: string | null
          default_commission_pct?: number
          email?: string | null
          id?: string
          kind?: string
          legal_name?: string | null
          name: string
          notes?: string | null
          payment_due_days?: number
          phone?: string | null
          pix_key?: string | null
          status?: string
          supplier_id?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          agency_name?: string | null
          bank_account?: string | null
          bank_agency?: string | null
          bank_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          creci_number?: string | null
          creci_state?: string | null
          default_commission_pct?: number
          email?: string | null
          id?: string
          kind?: string
          legal_name?: string | null
          name?: string
          notes?: string | null
          payment_due_days?: number
          phone?: string | null
          pix_key?: string | null
          status?: string
          supplier_id?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_brokers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_brokers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "commercial_brokers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "commercial_brokers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_proposal_counters: {
        Row: {
          company_id: string
          counter_year: number
          last_number: number
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          counter_year: number
          last_number?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          counter_year?: number
          last_number?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_proposal_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposal_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "commercial_proposal_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "commercial_proposal_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_proposal_payment_items: {
        Row: {
          adjustment_index: string | null
          amount_per_installment: number
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          first_due_date: string
          id: string
          installment_count: number
          interest_rate_monthly: number | null
          interval_months: number
          notes: string | null
          proposal_id: string
          sort_order: number
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          adjustment_index?: string | null
          amount_per_installment: number
          category: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          first_due_date: string
          id?: string
          installment_count?: number
          interest_rate_monthly?: number | null
          interval_months?: number
          notes?: string | null
          proposal_id: string
          sort_order?: number
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          adjustment_index?: string | null
          amount_per_installment?: number
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          first_due_date?: string
          id?: string
          installment_count?: number
          interest_rate_monthly?: number | null
          interval_months?: number
          notes?: string | null
          proposal_id?: string
          sort_order?: number
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_proposal_payment_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposal_payment_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "commercial_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_proposals: {
        Row: {
          broker_id: string | null
          broker_name: string | null
          client_id: string
          commission_pct: number
          company_id: string
          converted_at: string | null
          converted_sale_id: string | null
          created_at: string
          created_by: string | null
          discount_amount: number | null
          discount_percentage: number | null
          id: string
          list_price: number
          notes: string | null
          number: string
          parent_proposal_id: string | null
          project_id: string
          proposal_date: string
          proposed_amount: number
          reservation_until: string | null
          source_channel: string | null
          status: string
          terms: string | null
          unit_id: string
          updated_at: string
          updated_by: string | null
          valid_until: string
          version_no: number
        }
        Insert: {
          broker_id?: string | null
          broker_name?: string | null
          client_id: string
          commission_pct?: number
          company_id: string
          converted_at?: string | null
          converted_sale_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_percentage?: number | null
          id?: string
          list_price?: number
          notes?: string | null
          number: string
          parent_proposal_id?: string | null
          project_id: string
          proposal_date?: string
          proposed_amount: number
          reservation_until?: string | null
          source_channel?: string | null
          status?: string
          terms?: string | null
          unit_id: string
          updated_at?: string
          updated_by?: string | null
          valid_until: string
          version_no?: number
        }
        Update: {
          broker_id?: string | null
          broker_name?: string | null
          client_id?: string
          commission_pct?: number
          company_id?: string
          converted_at?: string | null
          converted_sale_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_percentage?: number | null
          id?: string
          list_price?: number
          notes?: string | null
          number?: string
          parent_proposal_id?: string | null
          project_id?: string
          proposal_date?: string
          proposed_amount?: number
          reservation_until?: string | null
          source_channel?: string | null
          status?: string
          terms?: string | null
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
          valid_until?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "commercial_proposals_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "commercial_brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposals_converted_sale_id_fkey"
            columns: ["converted_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposals_parent_proposal_id_fkey"
            columns: ["parent_proposal_id"]
            isOneToOne: false
            referencedRelation: "commercial_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "commercial_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "commercial_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_proposals_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_sale_commissions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          broker_id: string
          calculation_base: number
          commission_amount: number | null
          commission_pct: number
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          notes: string | null
          paid_amount: number | null
          paid_at: string | null
          payable_id: string | null
          project_id: string
          proposal_id: string | null
          role: string
          sale_id: string
          source_id: string
          source_system: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          broker_id: string
          calculation_base: number
          commission_amount?: number | null
          commission_pct: number
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payable_id?: string | null
          project_id: string
          proposal_id?: string | null
          role?: string
          sale_id: string
          source_id?: string
          source_system?: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          broker_id?: string
          calculation_base?: number
          commission_amount?: number | null
          commission_pct?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payable_id?: string | null
          project_id?: string
          proposal_id?: string | null
          role?: string
          sale_id?: string
          source_id?: string
          source_system?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_sale_commissions_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "commercial_brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "commercial_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_sale_commissions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string
          document: string | null
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          document?: string | null
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document?: string | null
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_memberships: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_index_values: {
        Row: {
          company_id: string
          correction_index_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          reference_month: string
          updated_at: string
          value: number
        }
        Insert: {
          company_id: string
          correction_index_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reference_month: string
          updated_at?: string
          value: number
        }
        Update: {
          company_id?: string
          correction_index_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reference_month?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "correction_index_values_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_index_values_correction_index_id_fkey"
            columns: ["correction_index_id"]
            isOneToOne: false
            referencedRelation: "correction_indices"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_indices: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          source_name: string | null
          status: string
          unit_label: string
          updated_at: string
          value_type: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          source_name?: string | null
          status?: string
          unit_label: string
          updated_at?: string
          value_type: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          source_name?: string | null
          status?: string
          unit_label?: string
          updated_at?: string
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_indices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_budget_groups: {
        Row: {
          budget_id: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          project_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          budget_id: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          project_id: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          budget_id?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          project_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_budget_groups_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budget_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budget_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_budget_item_composition_items: {
        Row: {
          coefficient: number
          company_id: string
          composition_id: string
          created_at: string
          created_by: string | null
          effective_coefficient: number | null
          id: string
          input_id: string
          notes: string | null
          price_source: string
          sort_order: number
          source_composition_item_id: string | null
          status: string
          unit_price: number
          updated_at: string
          waste_percentage: number
        }
        Insert: {
          coefficient?: number
          company_id: string
          composition_id: string
          created_at?: string
          created_by?: string | null
          effective_coefficient?: number | null
          id?: string
          input_id: string
          notes?: string | null
          price_source?: string
          sort_order?: number
          source_composition_item_id?: string | null
          status?: string
          unit_price?: number
          updated_at?: string
          waste_percentage?: number
        }
        Update: {
          coefficient?: number
          company_id?: string
          composition_id?: string
          created_at?: string
          created_by?: string | null
          effective_coefficient?: number | null
          id?: string
          input_id?: string
          notes?: string | null
          price_source?: string
          sort_order?: number
          source_composition_item_id?: string | null
          status?: string
          unit_price?: number
          updated_at?: string
          waste_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "engineering_budget_item_composi_source_composition_item_id_fkey"
            columns: ["source_composition_item_id"]
            isOneToOne: false
            referencedRelation: "engineering_service_composition_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_composition_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_composition_items_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "engineering_budget_item_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_composition_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_budget_item_compositions: {
        Row: {
          budget_id: string
          budget_item_id: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_customized: boolean
          notes: string | null
          project_id: string
          source_composition_id: string | null
          source_service_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          budget_id: string
          budget_item_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_customized?: boolean
          notes?: string | null
          project_id: string
          source_composition_id?: string | null
          source_service_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          budget_id?: string
          budget_item_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_customized?: boolean
          notes?: string | null
          project_id?: string
          source_composition_id?: string | null
          source_service_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_budget_item_compositions_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: true
            referencedRelation: "engineering_budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_source_composition_id_fkey"
            columns: ["source_composition_id"]
            isOneToOne: false
            referencedRelation: "engineering_service_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_item_compositions_source_service_id_fkey"
            columns: ["source_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_budget_items: {
        Row: {
          budget_id: string
          code: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          equipment_unit_cost: number
          group_id: string | null
          id: string
          labor_unit_cost: number
          material_unit_cost: number
          notes: string | null
          other_unit_cost: number
          project_id: string
          quantity: number
          service_id: string | null
          sort_order: number
          status: string
          total_direct_cost: number | null
          unit: string
          unit_direct_cost: number | null
          updated_at: string
        }
        Insert: {
          budget_id: string
          code?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          equipment_unit_cost?: number
          group_id?: string | null
          id?: string
          labor_unit_cost?: number
          material_unit_cost?: number
          notes?: string | null
          other_unit_cost?: number
          project_id: string
          quantity?: number
          service_id?: string | null
          sort_order?: number
          status?: string
          total_direct_cost?: number | null
          unit?: string
          unit_direct_cost?: number | null
          updated_at?: string
        }
        Update: {
          budget_id?: string
          code?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          equipment_unit_cost?: number
          group_id?: string | null
          id?: string
          labor_unit_cost?: number
          material_unit_cost?: number
          notes?: string | null
          other_unit_cost?: number
          project_id?: string
          quantity?: number
          service_id?: string | null
          sort_order?: number
          status?: string
          total_direct_cost?: number | null
          unit?: string
          unit_direct_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "engineering_budget_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budget_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_budgets: {
        Row: {
          area_m2: number
          base_set_at: string | null
          base_set_by: string | null
          bdi_percentage: number
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_base: boolean
          name: string
          notes: string | null
          project_id: string
          reference_date: string | null
          source_id: string | null
          source_system: string
          status: string
          updated_at: string
          version: string
        }
        Insert: {
          area_m2?: number
          base_set_at?: string | null
          base_set_by?: string | null
          bdi_percentage?: number
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_base?: boolean
          name: string
          notes?: string | null
          project_id: string
          reference_date?: string | null
          source_id?: string | null
          source_system?: string
          status?: string
          updated_at?: string
          version?: string
        }
        Update: {
          area_m2?: number
          base_set_at?: string | null
          base_set_by?: string | null
          bdi_percentage?: number
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_base?: boolean
          name?: string
          notes?: string | null
          project_id?: string
          reference_date?: string | null
          source_id?: string | null
          source_system?: string
          status?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_budgets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_contract_packages: {
        Row: {
          baseline_id: string
          code: string
          company_id: string
          contract_deadline: string
          contracting_lead_days: number
          created_at: string
          created_by: string | null
          id: string
          mobilization_lead_days: number
          mobilization_start: string
          name: string
          negotiation_lead_days: number
          negotiation_start: string
          notes: string | null
          planned_service_start: string
          planned_value: number
          project_id: string
          quotation_lead_days: number
          quotation_start: string
          record_status: string
          responsible: string | null
          service_id: string
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          baseline_id: string
          code: string
          company_id: string
          contract_deadline: string
          contracting_lead_days?: number
          created_at?: string
          created_by?: string | null
          id?: string
          mobilization_lead_days?: number
          mobilization_start: string
          name: string
          negotiation_lead_days?: number
          negotiation_start: string
          notes?: string | null
          planned_service_start: string
          planned_value?: number
          project_id: string
          quotation_lead_days?: number
          quotation_start: string
          record_status?: string
          responsible?: string | null
          service_id: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          baseline_id?: string
          code?: string
          company_id?: string
          contract_deadline?: string
          contracting_lead_days?: number
          created_at?: string
          created_by?: string | null
          id?: string
          mobilization_lead_days?: number
          mobilization_start?: string
          name?: string
          negotiation_lead_days?: number
          negotiation_start?: string
          notes?: string | null
          planned_service_start?: string
          planned_value?: number
          project_id?: string
          quotation_lead_days?: number
          quotation_start?: string
          record_status?: string
          responsible?: string | null
          service_id?: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_contract_packages_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "engineering_contract_packages_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_input_prices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          discount_percentage: number
          final_unit_price: number | null
          freight_unit_cost: number
          id: string
          input_id: string
          is_adopted: boolean
          notes: string | null
          other_unit_cost: number
          price_date: string
          project_id: string | null
          source: string | null
          status: string
          supplier_id: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_percentage?: number
          final_unit_price?: number | null
          freight_unit_cost?: number
          id?: string
          input_id: string
          is_adopted?: boolean
          notes?: string | null
          other_unit_cost?: number
          price_date?: string
          project_id?: string | null
          source?: string | null
          status?: string
          supplier_id?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_percentage?: number
          final_unit_price?: number | null
          freight_unit_cost?: number
          id?: string
          input_id?: string
          is_adopted?: boolean
          notes?: string | null
          other_unit_cost?: number
          price_date?: string
          project_id?: string | null
          source?: string | null
          status?: string
          supplier_id?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_input_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_input_prices_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_input_prices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_input_prices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_input_prices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_input_prices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "engineering_input_prices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "engineering_input_prices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_inputs: {
        Row: {
          brand_reference: string | null
          category: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          family_code: string | null
          family_label: string | null
          id: string
          notes: string | null
          source_code: string | null
          source_id: string | null
          source_system: string
          status: string
          technical_specification: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          brand_reference?: string | null
          category?: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          family_code?: string | null
          family_label?: string | null
          id?: string
          notes?: string | null
          source_code?: string | null
          source_id?: string | null
          source_system?: string
          status?: string
          technical_specification?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          brand_reference?: string | null
          category?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          family_code?: string | null
          family_label?: string | null
          id?: string
          notes?: string | null
          source_code?: string | null
          source_id?: string | null
          source_system?: string
          status?: string
          technical_specification?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_inputs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_schedule_activities: {
        Row: {
          baseline_id: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          duration_days: number
          id: string
          location_id: string | null
          name: string
          notes: string | null
          planned_cost: number
          planned_finish: string
          planned_start: string
          planning_status: string
          productivity_per_team_day: number
          project_id: string
          quantity_snapshot: number
          record_status: string
          service_id: string | null
          sort_order: number
          source: string
          team_count: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          baseline_id: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          id?: string
          location_id?: string | null
          name: string
          notes?: string | null
          planned_cost?: number
          planned_finish: string
          planned_start: string
          planning_status?: string
          productivity_per_team_day?: number
          project_id: string
          quantity_snapshot?: number
          record_status?: string
          service_id?: string | null
          sort_order?: number
          source?: string
          team_count?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Update: {
          baseline_id?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          id?: string
          location_id?: string | null
          name?: string
          notes?: string | null
          planned_cost?: number
          planned_finish?: string
          planned_start?: string
          planning_status?: string
          productivity_per_team_day?: number
          project_id?: string
          quantity_snapshot?: number
          record_status?: string
          service_id?: string | null
          sort_order?: number
          source?: string
          team_count?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_schedule_activities_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activities_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_schedule_activity_tracking: {
        Row: {
          activity_id: string
          actual_cost: number
          actual_finish: string | null
          actual_quantity: number
          actual_start: string | null
          baseline_id: string
          company_id: string
          created_at: string
          current_finish: string
          current_start: string
          id: string
          last_measurement_date: string | null
          notes: string | null
          progress_percent: number
          project_id: string
          team_count: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity_id: string
          actual_cost?: number
          actual_finish?: string | null
          actual_quantity?: number
          actual_start?: string | null
          baseline_id: string
          company_id: string
          created_at?: string
          current_finish: string
          current_start: string
          id?: string
          last_measurement_date?: string | null
          notes?: string | null
          progress_percent?: number
          project_id: string
          team_count?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity_id?: string
          actual_cost?: number
          actual_finish?: string | null
          actual_quantity?: number
          actual_start?: string | null
          baseline_id?: string
          company_id?: string
          created_at?: string
          current_finish?: string
          current_start?: string
          id?: string
          last_measurement_date?: string | null
          notes?: string | null
          progress_percent?: number
          project_id?: string
          team_count?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engineering_schedule_activity_tracking_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: true
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activity_tracking_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activity_tracking_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_activity_tracking_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_activity_tracking_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_activity_tracking_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_schedule_baselines: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          budget_id: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          project_id: string
          start_date: string
          status: string
          updated_at: string
          version: string
          work_on_saturday: boolean
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          budget_id: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          project_id: string
          start_date: string
          status?: string
          updated_at?: string
          version?: string
          work_on_saturday?: boolean
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          budget_id?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          project_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          version?: string
          work_on_saturday?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "engineering_schedule_baselines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_baselines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_schedule_dependencies: {
        Row: {
          baseline_id: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lag_days: number
          predecessor_id: string
          project_id: string
          relation_type: string
          successor_id: string
        }
        Insert: {
          baseline_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lag_days?: number
          predecessor_id: string
          project_id: string
          relation_type?: string
          successor_id: string
        }
        Update: {
          baseline_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lag_days?: number
          predecessor_id?: string
          project_id?: string
          relation_type?: string
          successor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_schedule_dependencies_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_dependencies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_dependencies_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_dependencies_successor_id_fkey"
            columns: ["successor_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_schedule_progress_measurements: {
        Row: {
          activity_id: string
          actual_cost: number
          actual_finish: string | null
          actual_quantity: number
          actual_start: string | null
          baseline_id: string
          company_id: string
          created_at: string
          created_by: string | null
          current_finish: string
          current_start: string
          id: string
          measurement_date: string
          notes: string | null
          progress_percent: number
          project_id: string
          team_count: number | null
          updated_at: string
        }
        Insert: {
          activity_id: string
          actual_cost?: number
          actual_finish?: string | null
          actual_quantity?: number
          actual_start?: string | null
          baseline_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          current_finish: string
          current_start: string
          id?: string
          measurement_date: string
          notes?: string | null
          progress_percent: number
          project_id: string
          team_count?: number | null
          updated_at?: string
        }
        Update: {
          activity_id?: string
          actual_cost?: number
          actual_finish?: string | null
          actual_quantity?: number
          actual_start?: string | null
          baseline_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_finish?: string
          current_start?: string
          id?: string
          measurement_date?: string
          notes?: string | null
          progress_percent?: number
          project_id?: string
          team_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_schedule_progress_measurements_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_progress_measurements_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_progress_measurements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_progress_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_progress_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_progress_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_schedule_service_weights: {
        Row: {
          baseline_id: string
          company_id: string
          created_at: string
          created_by: string | null
          distribution_method: string
          id: string
          notes: string | null
          physical_weight_percent: number
          project_id: string
          service_id: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          baseline_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          distribution_method?: string
          id?: string
          notes?: string | null
          physical_weight_percent: number
          project_id: string
          service_id: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          baseline_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          distribution_method?: string
          id?: string
          notes?: string | null
          physical_weight_percent?: number
          project_id?: string
          service_id?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engineering_schedule_service_weights_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_service_weights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_service_weights_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_service_weights_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_schedule_service_weights_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_schedule_service_weights_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_service_composition_items: {
        Row: {
          coefficient: number
          company_id: string
          composition_id: string
          created_at: string
          created_by: string | null
          effective_coefficient: number | null
          id: string
          input_id: string
          notes: string | null
          sort_order: number
          status: string
          updated_at: string
          waste_percentage: number
        }
        Insert: {
          coefficient?: number
          company_id: string
          composition_id: string
          created_at?: string
          created_by?: string | null
          effective_coefficient?: number | null
          id?: string
          input_id: string
          notes?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
          waste_percentage?: number
        }
        Update: {
          coefficient?: number
          company_id?: string
          composition_id?: string
          created_at?: string
          created_by?: string | null
          effective_coefficient?: number | null
          id?: string
          input_id?: string
          notes?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
          waste_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "engineering_service_composition_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_service_composition_items_composition_id_fkey"
            columns: ["composition_id"]
            isOneToOne: false
            referencedRelation: "engineering_service_compositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_service_composition_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_service_compositions: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          service_id: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          service_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          service_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_service_compositions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_service_compositions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_services: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          default_method: string
          description: string
          group_code: string | null
          id: string
          measurement_rule: string | null
          notes: string | null
          source_id: string | null
          source_system: string
          status: string
          takeoff_rule: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          default_method?: string
          description: string
          group_code?: string | null
          id?: string
          measurement_rule?: string | null
          notes?: string | null
          source_id?: string | null
          source_system?: string
          status?: string
          takeoff_rule?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_method?: string
          description?: string
          group_code?: string | null
          id?: string
          measurement_rule?: string | null
          notes?: string | null
          source_id?: string | null
          source_system?: string
          status?: string
          takeoff_rule?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_services_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_supply_plan_items: {
        Row: {
          available_stock: number
          baseline_id: string
          category_snapshot: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          delivery_deadline: string
          delivery_lead_days: number
          first_use_date: string
          id: string
          input_id: string
          name: string
          notes: string | null
          order_deadline: string
          planned_total_cost: number | null
          planned_unit_cost: number
          project_id: string
          purchase_quantity: number
          purchasing_lead_days: number
          quotation_lead_days: number
          quotation_start: string
          record_status: string
          required_quantity: number
          responsible: string | null
          safety_days: number
          status: string
          supplier_id: string | null
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          available_stock?: number
          baseline_id: string
          category_snapshot?: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          delivery_deadline: string
          delivery_lead_days?: number
          first_use_date: string
          id?: string
          input_id: string
          name: string
          notes?: string | null
          order_deadline: string
          planned_total_cost?: number | null
          planned_unit_cost?: number
          project_id: string
          purchase_quantity?: number
          purchasing_lead_days?: number
          quotation_lead_days?: number
          quotation_start: string
          record_status?: string
          required_quantity?: number
          responsible?: string | null
          safety_days?: number
          status?: string
          supplier_id?: string | null
          unit_snapshot?: string
          updated_at?: string
        }
        Update: {
          available_stock?: number
          baseline_id?: string
          category_snapshot?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          delivery_deadline?: string
          delivery_lead_days?: number
          first_use_date?: string
          id?: string
          input_id?: string
          name?: string
          notes?: string | null
          order_deadline?: string
          planned_total_cost?: number | null
          planned_unit_cost?: number
          project_id?: string
          purchase_quantity?: number
          purchasing_lead_days?: number
          quotation_lead_days?: number
          quotation_start?: string
          record_status?: string
          required_quantity?: number
          responsible?: string | null
          safety_days?: number
          status?: string
          supplier_id?: string | null
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_supply_plan_items_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_takeoff_locations: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          location_type: string
          name: string
          notes: string | null
          parent_id: string | null
          project_id: string
          repetitions: number
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_type?: string
          name: string
          notes?: string | null
          parent_id?: string | null
          project_id: string
          repetitions?: number
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_type?: string
          name?: string
          notes?: string | null
          parent_id?: string | null
          project_id?: string
          repetitions?: number
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_takeoff_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_takeoff_locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_takeoff_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_takeoff_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_takeoff_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engineering_takeoffs: {
        Row: {
          adjustment: number
          budget_id: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          dimension_a: number | null
          dimension_b: number | null
          dimension_c: number | null
          element_count: number
          formula: string
          id: string
          location_id: string | null
          location_repetitions_snapshot: number
          method: string
          project_id: string
          project_revision: string | null
          quantity_per_location: number
          record_status: string
          repetition_override: number | null
          repetition_reason: string | null
          service_id: string
          source_reference: string | null
          status: string
          total_quantity: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          adjustment?: number
          budget_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimension_a?: number | null
          dimension_b?: number | null
          dimension_c?: number | null
          element_count?: number
          formula: string
          id?: string
          location_id?: string | null
          location_repetitions_snapshot?: number
          method?: string
          project_id: string
          project_revision?: string | null
          quantity_per_location?: number
          record_status?: string
          repetition_override?: number | null
          repetition_reason?: string | null
          service_id: string
          source_reference?: string | null
          status?: string
          total_quantity?: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          adjustment?: number
          budget_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimension_a?: number | null
          dimension_b?: number | null
          dimension_c?: number | null
          element_count?: number
          formula?: string
          id?: string
          location_id?: string | null
          location_repetitions_snapshot?: number
          method?: string
          project_id?: string
          project_revision?: string | null
          quantity_per_location?: number
          record_status?: string
          repetition_override?: number | null
          repetition_reason?: string | null
          service_id?: string
          source_reference?: string | null
          status?: string
          total_quantity?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineering_takeoffs_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_takeoffs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_takeoffs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_takeoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_takeoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_takeoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_takeoffs_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_contract_measurement_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          measurement_id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          measurement_id: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          measurement_id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_contract_measurement_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_audit_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "execution_contract_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_contract_measurement_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          measurement_id: string
          mime_type: string | null
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          measurement_id: string
          mime_type?: string | null
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          measurement_id?: string
          mime_type?: string | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_contract_measurement_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_documents_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "execution_contract_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_contract_measurement_items: {
        Row: {
          accumulated_amount: number
          accumulated_quantity: number
          company_id: string
          contract_id: string
          contract_item_id: string
          contract_stage_id: string | null
          contracted_quantity: number
          created_at: string
          current_amount: number
          current_quantity: number
          id: string
          location_id: string | null
          location_name: string | null
          measurement_id: string
          notes: string | null
          previous_approved_amount: number
          previous_approved_quantity: number
          progress_percent: number
          project_id: string
          service_code: string
          service_id: string
          service_name: string
          sort_order: number
          unit_price: number
          unit_snapshot: string
          updated_at: string
          work_order_id: string | null
          work_order_item_id: string | null
        }
        Insert: {
          accumulated_amount: number
          accumulated_quantity: number
          company_id: string
          contract_id: string
          contract_item_id: string
          contract_stage_id?: string | null
          contracted_quantity: number
          created_at?: string
          current_amount: number
          current_quantity: number
          id?: string
          location_id?: string | null
          location_name?: string | null
          measurement_id: string
          notes?: string | null
          previous_approved_amount?: number
          previous_approved_quantity?: number
          progress_percent?: number
          project_id: string
          service_code: string
          service_id: string
          service_name: string
          sort_order?: number
          unit_price: number
          unit_snapshot: string
          updated_at?: string
          work_order_id?: string | null
          work_order_item_id?: string | null
        }
        Update: {
          accumulated_amount?: number
          accumulated_quantity?: number
          company_id?: string
          contract_id?: string
          contract_item_id?: string
          contract_stage_id?: string | null
          contracted_quantity?: number
          created_at?: string
          current_amount?: number
          current_quantity?: number
          id?: string
          location_id?: string | null
          location_name?: string | null
          measurement_id?: string
          notes?: string | null
          previous_approved_amount?: number
          previous_approved_quantity?: number
          progress_percent?: number
          project_id?: string
          service_code?: string
          service_id?: string
          service_name?: string
          sort_order?: number
          unit_price?: number
          unit_snapshot?: string
          updated_at?: string
          work_order_id?: string | null
          work_order_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_contract_measurement_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_contract_item_id_fkey"
            columns: ["contract_item_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_contract_stage_id_fkey"
            columns: ["contract_stage_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "execution_contract_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurement_items_work_order_item_id_fkey"
            columns: ["work_order_item_id"]
            isOneToOne: false
            referencedRelation: "execution_work_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_contract_measurements: {
        Row: {
          advance_deduction_amount: number
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          contract_id: string
          contractor_notes: string | null
          contractual_retention_amount: number
          contractual_retention_percent: number
          created_at: string
          created_by: string
          gross_amount: number
          guarantee_retention_amount: number
          guarantee_retention_percent: number
          id: string
          invoice_date: string | null
          invoice_gross_amount: number | null
          invoice_number: string | null
          measurement_number: string
          net_amount: number
          notes: string | null
          other_discount_amount: number
          over_contract_confirmed: boolean
          over_contract_confirmed_at: string | null
          over_contract_confirmed_by: string | null
          paid_amount: number
          paid_at: string | null
          payable_id: string | null
          period_end: string
          period_start: string
          project_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requester_name: string | null
          requester_user_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          sent_to_finance_at: string | null
          sent_to_finance_by: string | null
          sequence_no: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          supplier_id: string
          tax_withholding_amount: number
          total_deductions: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          advance_deduction_amount?: number
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          contract_id: string
          contractor_notes?: string | null
          contractual_retention_amount?: number
          contractual_retention_percent?: number
          created_at?: string
          created_by: string
          gross_amount?: number
          guarantee_retention_amount?: number
          guarantee_retention_percent?: number
          id?: string
          invoice_date?: string | null
          invoice_gross_amount?: number | null
          invoice_number?: string | null
          measurement_number: string
          net_amount?: number
          notes?: string | null
          other_discount_amount?: number
          over_contract_confirmed?: boolean
          over_contract_confirmed_at?: string | null
          over_contract_confirmed_by?: string | null
          paid_amount?: number
          paid_at?: string | null
          payable_id?: string | null
          period_end: string
          period_start: string
          project_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_name?: string | null
          requester_user_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          sent_to_finance_at?: string | null
          sent_to_finance_by?: string | null
          sequence_no: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id: string
          tax_withholding_amount?: number
          total_deductions?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          advance_deduction_amount?: number
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          contract_id?: string
          contractor_notes?: string | null
          contractual_retention_amount?: number
          contractual_retention_percent?: number
          created_at?: string
          created_by?: string
          gross_amount?: number
          guarantee_retention_amount?: number
          guarantee_retention_percent?: number
          id?: string
          invoice_date?: string | null
          invoice_gross_amount?: number | null
          invoice_number?: string | null
          measurement_number?: string
          net_amount?: number
          notes?: string | null
          other_discount_amount?: number
          over_contract_confirmed?: boolean
          over_contract_confirmed_at?: string | null
          over_contract_confirmed_by?: string | null
          paid_amount?: number
          paid_at?: string | null
          payable_id?: string | null
          period_end?: string
          period_start?: string
          project_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_name?: string | null
          requester_user_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          sent_to_finance_at?: string | null
          sent_to_finance_by?: string | null
          sequence_no?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id?: string
          tax_withholding_amount?: number
          total_deductions?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_contract_measurements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_contract_measurements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          daily_log_id: string
          details: Json
          id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          daily_log_id: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          daily_log_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_audit_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_occurrences: {
        Row: {
          action_taken: string | null
          affects_schedule: boolean
          company_id: string
          created_at: string
          created_by: string | null
          daily_log_id: string
          description: string
          id: string
          impact: string
          is_critical: boolean
          is_safety_event: boolean
          occurred_at: string | null
          occurrence_type: string
          project_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          affects_schedule?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          daily_log_id: string
          description: string
          id?: string
          impact?: string
          is_critical?: boolean
          is_safety_event?: boolean
          occurred_at?: string | null
          occurrence_type: string
          project_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          affects_schedule?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          daily_log_id?: string
          description?: string
          id?: string
          impact?: string
          is_critical?: boolean
          is_safety_event?: boolean
          occurred_at?: string | null
          occurrence_type?: string
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_occurrences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_occurrences_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_occurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_occurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_occurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_photos: {
        Row: {
          caption: string | null
          company_id: string
          daily_log_id: string
          file_name: string
          file_size: number | null
          id: string
          location_id: string | null
          mime_type: string | null
          occurrence_id: string | null
          project_id: string
          service_row_id: string | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          daily_log_id: string
          file_name: string
          file_size?: number | null
          id?: string
          location_id?: string | null
          mime_type?: string | null
          occurrence_id?: string | null
          project_id: string
          service_row_id?: string | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          daily_log_id?: string
          file_name?: string
          file_size?: number | null
          id?: string
          location_id?: string | null
          mime_type?: string | null
          occurrence_id?: string | null
          project_id?: string
          service_row_id?: string | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_photos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_log_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_photos_service_row_id_fkey"
            columns: ["service_row_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_log_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_services: {
        Row: {
          company_id: string
          created_at: string
          daily_log_id: string
          executed_quantity: number | null
          id: string
          location_id: string | null
          location_name: string | null
          notes: string | null
          planned_quantity: number | null
          progress_percent: number | null
          project_id: string
          schedule_activity_id: string | null
          service_code: string
          service_id: string | null
          service_name: string
          sort_order: number
          source: string
          unit_snapshot: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          daily_log_id: string
          executed_quantity?: number | null
          id?: string
          location_id?: string | null
          location_name?: string | null
          notes?: string | null
          planned_quantity?: number | null
          progress_percent?: number | null
          project_id: string
          schedule_activity_id?: string | null
          service_code: string
          service_id?: string | null
          service_name: string
          sort_order?: number
          source?: string
          unit_snapshot?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          daily_log_id?: string
          executed_quantity?: number | null
          id?: string
          location_id?: string | null
          location_name?: string | null
          notes?: string | null
          planned_quantity?: number | null
          progress_percent?: number | null
          project_id?: string
          schedule_activity_id?: string | null
          service_code?: string
          service_id?: string | null
          service_name?: string
          sort_order?: number
          source?: string
          unit_snapshot?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_services_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_settings: {
        Row: {
          allow_complementary: boolean
          auto_create: boolean
          company_id: string
          created_at: string
          created_by: string | null
          day_end: string
          default_shift: string
          id: string
          project_id: string
          required_photo_count: number
          retroactive_days: number
          updated_at: string
          updated_by: string | null
          workdays: number[]
        }
        Insert: {
          allow_complementary?: boolean
          auto_create?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          day_end?: string
          default_shift?: string
          id?: string
          project_id: string
          required_photo_count?: number
          retroactive_days?: number
          updated_at?: string
          updated_by?: string | null
          workdays?: number[]
        }
        Update: {
          allow_complementary?: boolean
          auto_create?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          day_end?: string
          default_shift?: string
          id?: string
          project_id?: string
          required_photo_count?: number
          retroactive_days?: number
          updated_at?: string
          updated_by?: string | null
          workdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_weather: {
        Row: {
          company_id: string
          condition: string
          created_at: string
          daily_log_id: string
          id: string
          notes: string | null
          period: string
          project_id: string
          rain_mm: number
          stopped_hours: number
          temperature_c: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          condition: string
          created_at?: string
          daily_log_id: string
          id?: string
          notes?: string | null
          period: string
          project_id: string
          rain_mm?: number
          stopped_hours?: number
          temperature_c?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          condition?: string
          created_at?: string
          daily_log_id?: string
          id?: string
          notes?: string | null
          period?: string
          project_id?: string
          rain_mm?: number
          stopped_hours?: number
          temperature_c?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_weather_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_weather_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_weather_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_weather_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_weather_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_log_workforce: {
        Row: {
          break_hours: number
          company_id: string
          company_name: string
          created_at: string
          daily_log_id: string
          id: string
          notes: string | null
          project_id: string
          role_name: string
          sort_order: number
          supplier_id: string | null
          updated_at: string
          work_end: string | null
          work_start: string | null
          worker_count: number
        }
        Insert: {
          break_hours?: number
          company_id: string
          company_name: string
          created_at?: string
          daily_log_id: string
          id?: string
          notes?: string | null
          project_id: string
          role_name: string
          sort_order?: number
          supplier_id?: string | null
          updated_at?: string
          work_end?: string | null
          work_start?: string | null
          worker_count: number
        }
        Update: {
          break_hours?: number
          company_id?: string
          company_name?: string
          created_at?: string
          daily_log_id?: string
          id?: string
          notes?: string | null
          project_id?: string
          role_name?: string
          sort_order?: number
          supplier_id?: string | null
          updated_at?: string
          work_end?: string | null
          work_start?: string | null
          worker_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_log_workforce_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_daily_log_workforce_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_daily_logs: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          completion_percent: number
          confirmed_by_filler: boolean
          created_at: string
          created_by: string
          diary_type: string
          general_notes: string | null
          id: string
          is_current: boolean
          log_date: string
          log_number: string
          no_occurrences: boolean
          no_safety_events: boolean
          project_id: string
          reopened_at: string | null
          reopened_by: string | null
          reopened_from_id: string | null
          reopened_reason: string | null
          responsible_name: string
          responsible_user_id: string
          root_log_id: string | null
          shift: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string | null
          version: number
          work_end: string | null
          work_start: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          completion_percent?: number
          confirmed_by_filler?: boolean
          created_at?: string
          created_by: string
          diary_type?: string
          general_notes?: string | null
          id?: string
          is_current?: boolean
          log_date: string
          log_number: string
          no_occurrences?: boolean
          no_safety_events?: boolean
          project_id: string
          reopened_at?: string | null
          reopened_by?: string | null
          reopened_from_id?: string | null
          reopened_reason?: string | null
          responsible_name: string
          responsible_user_id: string
          root_log_id?: string | null
          shift?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          work_end?: string | null
          work_start?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          completion_percent?: number
          confirmed_by_filler?: boolean
          created_at?: string
          created_by?: string
          diary_type?: string
          general_notes?: string | null
          id?: string
          is_current?: boolean
          log_date?: string
          log_number?: string
          no_occurrences?: boolean
          no_safety_events?: boolean
          project_id?: string
          reopened_at?: string | null
          reopened_by?: string | null
          reopened_from_id?: string | null
          reopened_reason?: string | null
          responsible_name?: string
          responsible_user_id?: string
          root_log_id?: string | null
          shift?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          work_end?: string | null
          work_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_daily_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_daily_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_logs_reopened_from_id_fkey"
            columns: ["reopened_from_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_daily_logs_root_log_id_fkey"
            columns: ["root_log_id"]
            isOneToOne: false
            referencedRelation: "execution_daily_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_material_request_items: {
        Row: {
          category_snapshot: string
          company_id: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id: string | null
          created_at: string
          id: string
          input_code: string
          input_id: string
          input_name: string
          notes: string | null
          ordered_quantity: number
          project_id: string
          request_id: string
          requested_quantity: number
          sort_order: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          category_snapshot: string
          company_id: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id?: string | null
          created_at?: string
          id?: string
          input_code: string
          input_id: string
          input_name: string
          notes?: string | null
          ordered_quantity?: number
          project_id: string
          request_id: string
          requested_quantity: number
          sort_order?: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          category_snapshot?: string
          company_id?: string
          cost_center_code?: string
          cost_center_name?: string
          cost_center_service_id?: string | null
          created_at?: string
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          notes?: string | null
          ordered_quantity?: number
          project_id?: string
          request_id?: string
          requested_quantity?: number
          sort_order?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_material_request_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_material_request_items_cost_center_service_fk"
            columns: ["cost_center_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_material_request_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_material_request_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_material_request_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_material_request_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_material_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "execution_material_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_material_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          budget_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          needed_date: string
          notes: string | null
          project_id: string
          request_number: string
          requester_name: string
          requester_user_id: string
          sequence_no: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          budget_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          needed_date: string
          notes?: string | null
          project_id: string
          request_number: string
          requester_name: string
          requester_user_id: string
          sequence_no: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          budget_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          needed_date?: string
          notes?: string | null
          project_id?: string
          request_number?: string
          requester_name?: string
          requester_user_id?: string
          sequence_no?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_material_requests_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_material_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_material_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_material_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_material_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_competition_offer_items: {
        Row: {
          company_id: string
          created_at: string
          id: string
          meets_specification: boolean
          notes: string | null
          offer_id: string
          offered_quantity: number
          project_id: string
          request_item_id: string
          sort_order: number
          total_amount: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          meets_specification?: boolean
          notes?: string | null
          offer_id: string
          offered_quantity: number
          project_id: string
          request_item_id: string
          sort_order?: number
          total_amount: number
          unit_price: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          meets_specification?: boolean
          notes?: string | null
          offer_id?: string
          offered_quantity?: number
          project_id?: string
          request_item_id?: string
          sort_order?: number
          total_amount?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_competition_offer_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competition_offer_items_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "execution_service_competition_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competition_offer_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_competition_offer_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_competition_offer_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competition_offer_items_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: false
            referencedRelation: "execution_service_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_competition_offers: {
        Row: {
          commercial_score: number | null
          company_id: string
          competition_id: string
          id: string
          notes: string | null
          payment_days: number
          project_id: string
          proposal_date: string | null
          proposal_number: string | null
          proposed_finish: string | null
          proposed_start: string | null
          received_at: string
          received_by: string | null
          status: string
          supplier_id: string
          technical_score: number | null
          total_amount: number
          updated_at: string
          validity_date: string | null
        }
        Insert: {
          commercial_score?: number | null
          company_id: string
          competition_id: string
          id?: string
          notes?: string | null
          payment_days?: number
          project_id: string
          proposal_date?: string | null
          proposal_number?: string | null
          proposed_finish?: string | null
          proposed_start?: string | null
          received_at?: string
          received_by?: string | null
          status?: string
          supplier_id: string
          technical_score?: number | null
          total_amount?: number
          updated_at?: string
          validity_date?: string | null
        }
        Update: {
          commercial_score?: number | null
          company_id?: string
          competition_id?: string
          id?: string
          notes?: string | null
          payment_days?: number
          project_id?: string
          proposal_date?: string | null
          proposal_number?: string | null
          proposed_finish?: string | null
          proposed_start?: string | null
          received_at?: string
          received_by?: string | null
          status?: string
          supplier_id?: string
          technical_score?: number | null
          total_amount?: number
          updated_at?: string
          validity_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_competition_offers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "execution_service_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_service_competition_offers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_competitions: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          award_criteria: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          competition_number: string
          created_at: string
          created_by: string
          generated_contract_id: string | null
          id: string
          notes: string | null
          project_id: string
          request_id: string
          response_deadline: string | null
          sequence_no: number
          status: string
          title: string
          updated_at: string
          winner_offer_id: string | null
          winner_supplier_id: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          award_criteria?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          competition_number: string
          created_at?: string
          created_by: string
          generated_contract_id?: string | null
          id?: string
          notes?: string | null
          project_id: string
          request_id: string
          response_deadline?: string | null
          sequence_no: number
          status?: string
          title: string
          updated_at?: string
          winner_offer_id?: string | null
          winner_supplier_id?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          award_criteria?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          competition_number?: string
          created_at?: string
          created_by?: string
          generated_contract_id?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          request_id?: string
          response_deadline?: string | null
          sequence_no?: number
          status?: string
          title?: string
          updated_at?: string
          winner_offer_id?: string | null
          winner_supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_competitions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competitions_generated_contract_id_fkey"
            columns: ["generated_contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_competitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_competitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competitions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "execution_service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competitions_winner_offer_id_fkey"
            columns: ["winner_offer_id"]
            isOneToOne: false
            referencedRelation: "execution_service_competition_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_competitions_winner_supplier_id_fkey"
            columns: ["winner_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_service_competitions_winner_supplier_id_fkey"
            columns: ["winner_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_service_competitions_winner_supplier_id_fkey"
            columns: ["winner_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contract_amendment_items: {
        Row: {
          amendment_id: string
          company_id: string
          contract_id: string
          contract_item_id: string
          created_at: string
          created_by: string
          id: string
          project_id: string
          service_id: string
          value_change: number
        }
        Insert: {
          amendment_id: string
          company_id: string
          contract_id: string
          contract_item_id: string
          created_at?: string
          created_by: string
          id?: string
          project_id: string
          service_id: string
          value_change: number
        }
        Update: {
          amendment_id?: string
          company_id?: string
          contract_id?: string
          contract_item_id?: string
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string
          service_id?: string
          value_change?: number
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contract_amendment_item_contract_item_id_fkey"
            columns: ["contract_item_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_amendment_id_fkey"
            columns: ["amendment_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_amendments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendment_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contract_amendments: {
        Row: {
          amendment_number: string
          amendment_type: string
          approved_at: string
          approved_by: string
          company_id: string
          contract_id: string
          created_at: string
          created_by: string
          description: string
          id: string
          justification: string
          new_end_date: string | null
          previous_end_date: string | null
          project_id: string
          sequence_no: number
          value_change: number
        }
        Insert: {
          amendment_number: string
          amendment_type: string
          approved_at?: string
          approved_by: string
          company_id: string
          contract_id: string
          created_at?: string
          created_by: string
          description: string
          id?: string
          justification: string
          new_end_date?: string | null
          previous_end_date?: string | null
          project_id: string
          sequence_no: number
          value_change?: number
        }
        Update: {
          amendment_number?: string
          amendment_type?: string
          approved_at?: string
          approved_by?: string
          company_id?: string
          contract_id?: string
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          justification?: string
          new_end_date?: string | null
          previous_end_date?: string | null
          project_id?: string
          sequence_no?: number
          value_change?: number
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contract_amendments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_amendments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contract_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          contract_id: string
          details: Json
          id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          contract_id: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          contract_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contract_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_audit_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contract_documents: {
        Row: {
          amendment_id: string | null
          caption: string | null
          company_id: string
          contract_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          amendment_id?: string | null
          caption?: string | null
          company_id: string
          contract_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          amendment_id?: string | null
          caption?: string | null
          company_id?: string
          contract_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contract_documents_amendment_id_fkey"
            columns: ["amendment_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_amendments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contract_items: {
        Row: {
          company_id: string
          contract_id: string
          contracted_quantity: number
          created_at: string
          id: string
          location_id: string | null
          location_name: string | null
          measured_quantity: number
          measured_value: number
          planned_finish: string | null
          planned_start: string | null
          project_id: string
          schedule_activity_id: string | null
          scope_notes: string | null
          service_code: string
          service_id: string
          service_name: string
          sort_order: number
          total_value: number
          unit_price: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contract_id: string
          contracted_quantity: number
          created_at?: string
          id?: string
          location_id?: string | null
          location_name?: string | null
          measured_quantity?: number
          measured_value?: number
          planned_finish?: string | null
          planned_start?: string | null
          project_id: string
          schedule_activity_id?: string | null
          scope_notes?: string | null
          service_code: string
          service_id: string
          service_name: string
          sort_order?: number
          total_value: number
          unit_price: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contract_id?: string
          contracted_quantity?: number
          created_at?: string
          id?: string
          location_id?: string | null
          location_name?: string | null
          measured_quantity?: number
          measured_value?: number
          planned_finish?: string | null
          planned_start?: string | null
          project_id?: string
          schedule_activity_id?: string | null
          scope_notes?: string | null
          service_code?: string
          service_id?: string
          service_name?: string
          sort_order?: number
          total_value?: number
          unit_price?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contract_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contract_stages: {
        Row: {
          company_id: string
          contract_id: string
          contract_item_id: string
          contracted_quantity: number
          created_at: string
          description: string | null
          id: string
          location_id: string | null
          measured_quantity: number
          measured_value: number
          measurement_mode: string
          opening_measured_quantity: number
          opening_measured_value: number
          project_id: string
          service_id: string
          sort_order: number
          stage_code: string
          stage_name: string
          total_value: number
          unit_price: number
          unit_snapshot: string
          updated_at: string
          weight_percent: number
        }
        Insert: {
          company_id: string
          contract_id: string
          contract_item_id: string
          contracted_quantity: number
          created_at?: string
          description?: string | null
          id?: string
          location_id?: string | null
          measured_quantity?: number
          measured_value?: number
          measurement_mode?: string
          opening_measured_quantity?: number
          opening_measured_value?: number
          project_id: string
          service_id: string
          sort_order?: number
          stage_code: string
          stage_name: string
          total_value: number
          unit_price: number
          unit_snapshot: string
          updated_at?: string
          weight_percent: number
        }
        Update: {
          company_id?: string
          contract_id?: string
          contract_item_id?: string
          contracted_quantity?: number
          created_at?: string
          description?: string | null
          id?: string
          location_id?: string | null
          measured_quantity?: number
          measured_value?: number
          measurement_mode?: string
          opening_measured_quantity?: number
          opening_measured_value?: number
          project_id?: string
          service_id?: string
          sort_order?: number
          stage_code?: string
          stage_name?: string
          total_value?: number
          unit_price?: number
          unit_snapshot?: string
          updated_at?: string
          weight_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contract_stages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_contract_item_id_fkey"
            columns: ["contract_item_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contract_stages_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_contracts: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          adjustment_base_date: string | null
          adjustment_index: string | null
          amendments_value: number
          budget_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_number: string
          created_at: string
          created_by: string
          current_value: number
          end_date: string
          finished_at: string | null
          finished_by: string | null
          guarantee_months: number
          guarantee_percent: number
          id: string
          invoiced_value: number
          measured_value: number
          notes: string | null
          original_value: number
          paid_value: number
          payment_days: number
          project_id: string
          responsible_name: string | null
          responsible_user_id: string | null
          retained_value: number
          retention_percent: number
          scope_summary: string
          sequence_no: number
          signed_date: string | null
          source_competition_id: string | null
          source_request_id: string | null
          start_date: string
          status: string
          supplier_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          adjustment_base_date?: string | null
          adjustment_index?: string | null
          amendments_value?: number
          budget_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_number: string
          created_at?: string
          created_by: string
          current_value?: number
          end_date: string
          finished_at?: string | null
          finished_by?: string | null
          guarantee_months?: number
          guarantee_percent?: number
          id?: string
          invoiced_value?: number
          measured_value?: number
          notes?: string | null
          original_value?: number
          paid_value?: number
          payment_days?: number
          project_id: string
          responsible_name?: string | null
          responsible_user_id?: string | null
          retained_value?: number
          retention_percent?: number
          scope_summary: string
          sequence_no: number
          signed_date?: string | null
          source_competition_id?: string | null
          source_request_id?: string | null
          start_date: string
          status?: string
          supplier_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          adjustment_base_date?: string | null
          adjustment_index?: string | null
          amendments_value?: number
          budget_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_number?: string
          created_at?: string
          created_by?: string
          current_value?: number
          end_date?: string
          finished_at?: string | null
          finished_by?: string | null
          guarantee_months?: number
          guarantee_percent?: number
          id?: string
          invoiced_value?: number
          measured_value?: number
          notes?: string | null
          original_value?: number
          paid_value?: number
          payment_days?: number
          project_id?: string
          responsible_name?: string | null
          responsible_user_id?: string | null
          retained_value?: number
          retention_percent?: number
          scope_summary?: string
          sequence_no?: number
          signed_date?: string | null
          source_competition_id?: string | null
          source_request_id?: string | null
          start_date?: string
          status?: string
          supplier_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_contracts_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contracts_source_competition_id_fkey"
            columns: ["source_competition_id"]
            isOneToOne: false
            referencedRelation: "execution_service_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contracts_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: false
            referencedRelation: "execution_service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_contracts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_service_contracts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_service_contracts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_request_items: {
        Row: {
          company_id: string
          created_at: string
          estimated_total: number
          estimated_unit_price: number
          id: string
          location_id: string | null
          location_name: string | null
          measurement_notes: string | null
          project_id: string
          request_id: string
          requested_quantity: number
          schedule_activity_id: string | null
          scope_notes: string | null
          service_code: string
          service_id: string
          service_name: string
          sort_order: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          estimated_total?: number
          estimated_unit_price?: number
          id?: string
          location_id?: string | null
          location_name?: string | null
          measurement_notes?: string | null
          project_id: string
          request_id: string
          requested_quantity: number
          schedule_activity_id?: string | null
          scope_notes?: string | null
          service_code: string
          service_id: string
          service_name: string
          sort_order?: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          estimated_total?: number
          estimated_unit_price?: number
          id?: string
          location_id?: string | null
          location_name?: string | null
          measurement_notes?: string | null
          project_id?: string
          request_id?: string
          requested_quantity?: number
          schedule_activity_id?: string | null
          scope_notes?: string | null
          service_code?: string
          service_id?: string
          service_name?: string
          sort_order?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_request_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_request_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_request_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_request_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_request_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "execution_service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_request_items_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_request_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_service_requests: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          budget_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          needed_finish: string | null
          needed_start: string | null
          notes: string | null
          project_id: string
          request_number: string
          requester_name: string | null
          requester_user_id: string | null
          scope_summary: string
          sequence_no: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          budget_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          needed_finish?: string | null
          needed_start?: string | null
          notes?: string | null
          project_id: string
          request_number: string
          requester_name?: string | null
          requester_user_id?: string | null
          scope_summary: string
          sequence_no: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          budget_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          needed_finish?: string | null
          needed_start?: string | null
          notes?: string | null
          project_id?: string
          request_number?: string
          requester_name?: string | null
          requester_user_id?: string | null
          scope_summary?: string
          sequence_no?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_service_requests_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_service_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_service_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_order_acceptances: {
        Row: {
          accepted_at: string
          accepted_by: string
          company_id: string
          created_at: string
          id: string
          notes: string | null
          project_id: string
          punch_list: Json
          quality_reference: string | null
          quality_status: string
          result: string
          sequence_no: number
          work_order_id: string
        }
        Insert: {
          accepted_at?: string
          accepted_by: string
          company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          punch_list?: Json
          quality_reference?: string | null
          quality_status: string
          result: string
          sequence_no: number
          work_order_id: string
        }
        Update: {
          accepted_at?: string
          accepted_by?: string
          company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          punch_list?: Json
          quality_reference?: string | null
          quality_status?: string
          result?: string
          sequence_no?: number
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_order_acceptances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_acceptances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_acceptances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_acceptances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_acceptances_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_order_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
          work_order_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
          work_order_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_order_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_audit_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_order_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          work_order_id: string
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          work_order_id: string
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_order_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_documents_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_order_installments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          due_date: string
          id: string
          installment_label: string
          payable_id: string | null
          payment_method: string | null
          project_id: string
          sequence_no: number
          updated_at: string
          work_order_id: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_label: string
          payable_id?: string | null
          payment_method?: string | null
          project_id: string
          sequence_no: number
          updated_at?: string
          work_order_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_label?: string
          payable_id?: string | null
          payment_method?: string | null
          project_id?: string
          sequence_no?: number
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_order_installments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_installments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_installments_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_order_items: {
        Row: {
          accepted_quantity: number
          accepted_value: number
          authorized_quantity: number
          authorized_value: number
          company_id: string
          contract_id: string
          contract_item_id: string
          created_at: string
          executed_quantity: number
          executed_value: number
          id: string
          location_id: string | null
          location_name: string | null
          measured_quantity: number
          measured_value: number
          planned_finish: string | null
          planned_start: string | null
          project_id: string
          schedule_activity_id: string | null
          scope_notes: string | null
          service_code: string
          service_id: string
          service_name: string
          sort_order: number
          unit_price: number
          unit_snapshot: string
          updated_at: string
          work_order_id: string
        }
        Insert: {
          accepted_quantity?: number
          accepted_value?: number
          authorized_quantity: number
          authorized_value: number
          company_id: string
          contract_id: string
          contract_item_id: string
          created_at?: string
          executed_quantity?: number
          executed_value?: number
          id?: string
          location_id?: string | null
          location_name?: string | null
          measured_quantity?: number
          measured_value?: number
          planned_finish?: string | null
          planned_start?: string | null
          project_id: string
          schedule_activity_id?: string | null
          scope_notes?: string | null
          service_code: string
          service_id: string
          service_name: string
          sort_order?: number
          unit_price: number
          unit_snapshot: string
          updated_at?: string
          work_order_id: string
        }
        Update: {
          accepted_quantity?: number
          accepted_value?: number
          authorized_quantity?: number
          authorized_value?: number
          company_id?: string
          contract_id?: string
          contract_item_id?: string
          created_at?: string
          executed_quantity?: number
          executed_value?: number
          id?: string
          location_id?: string | null
          location_name?: string | null
          measured_quantity?: number
          measured_value?: number
          planned_finish?: string | null
          planned_start?: string | null
          project_id?: string
          schedule_activity_id?: string | null
          scope_notes?: string | null
          service_code?: string
          service_id?: string
          service_name?: string
          sort_order?: number
          unit_price?: number
          unit_snapshot?: string
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_order_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_contract_item_id_fkey"
            columns: ["contract_item_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_items_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_order_prerequisites: {
        Row: {
          code: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          is_completed: boolean
          is_required: boolean
          notes: string | null
          project_id: string
          sort_order: number
          title: string
          updated_at: string
          work_order_id: string
        }
        Insert: {
          code?: string | null
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          is_required?: boolean
          notes?: string | null
          project_id: string
          sort_order?: number
          title: string
          updated_at?: string
          work_order_id: string
        }
        Update: {
          code?: string | null
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          is_required?: boolean
          notes?: string | null
          project_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_order_prerequisites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_prerequisites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_prerequisites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_order_prerequisites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_order_prerequisites_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "execution_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_work_orders: {
        Row: {
          acceptance_notes: string | null
          acceptance_requested_at: string | null
          acceptance_requested_by: string | null
          acceptance_result: string | null
          accepted_at: string | null
          accepted_by: string | null
          accepted_value: number
          actual_finish: string | null
          actual_start: string | null
          authorized_value: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          contract_id: string
          created_at: string
          created_by: string
          executed_value: number
          financial_mode: string
          id: string
          measured_value: number
          notes: string | null
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          payables_generated_at: string | null
          payment_total: number
          planned_finish: string
          planned_start: string
          project_id: string
          quality_requirements: string | null
          released_at: string | null
          released_by: string | null
          responsible_name: string | null
          responsible_user_id: string | null
          safety_instructions: string | null
          scope_summary: string
          sequence_no: number
          site_instructions: string | null
          started_at: string | null
          started_by: string | null
          status: string
          supplier_contact_name: string | null
          supplier_contact_phone: string | null
          supplier_id: string
          title: string
          updated_at: string
          updated_by: string | null
          work_order_number: string
        }
        Insert: {
          acceptance_notes?: string | null
          acceptance_requested_at?: string | null
          acceptance_requested_by?: string | null
          acceptance_result?: string | null
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_value?: number
          actual_finish?: string | null
          actual_start?: string | null
          authorized_value?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          contract_id: string
          created_at?: string
          created_by: string
          executed_value?: number
          financial_mode?: string
          id?: string
          measured_value?: number
          notes?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          payables_generated_at?: string | null
          payment_total?: number
          planned_finish: string
          planned_start: string
          project_id: string
          quality_requirements?: string | null
          released_at?: string | null
          released_by?: string | null
          responsible_name?: string | null
          responsible_user_id?: string | null
          safety_instructions?: string | null
          scope_summary: string
          sequence_no: number
          site_instructions?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          supplier_contact_name?: string | null
          supplier_contact_phone?: string | null
          supplier_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
          work_order_number: string
        }
        Update: {
          acceptance_notes?: string | null
          acceptance_requested_at?: string | null
          acceptance_requested_by?: string | null
          acceptance_result?: string | null
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_value?: number
          actual_finish?: string | null
          actual_start?: string | null
          authorized_value?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          contract_id?: string
          created_at?: string
          created_by?: string
          executed_value?: number
          financial_mode?: string
          id?: string
          measured_value?: number
          notes?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          payables_generated_at?: string | null
          payment_total?: number
          planned_finish?: string
          planned_start?: string
          project_id?: string
          quality_requirements?: string | null
          released_at?: string | null
          released_by?: string | null
          responsible_name?: string | null
          responsible_user_id?: string | null
          safety_instructions?: string | null
          scope_summary?: string
          sequence_no?: number
          site_instructions?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          supplier_contact_name?: string | null
          supplier_contact_phone?: string | null
          supplier_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          work_order_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_work_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_orders_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "execution_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_work_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_work_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "execution_work_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_bank_accounts: {
        Row: {
          account_digit: string | null
          account_number: string
          account_type: string
          agency: string | null
          allow_negative: boolean
          bank_code: string | null
          bank_name: string
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          id: string
          is_default: boolean
          label: string
          legal_entity_id: string | null
          notes: string | null
          opening_balance: number
          opening_balance_date: string
          pix_key: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_digit?: string | null
          account_number: string
          account_type?: string
          agency?: string | null
          allow_negative?: boolean
          bank_code?: string | null
          bank_name: string
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          id?: string
          is_default?: boolean
          label: string
          legal_entity_id?: string | null
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string
          pix_key?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_digit?: string | null
          account_number?: string
          account_type?: string
          agency?: string | null
          allow_negative?: boolean
          bank_code?: string | null
          bank_name?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          id?: string
          is_default?: boolean
          label?: string
          legal_entity_id?: string | null
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string
          pix_key?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_accounts_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_bank_transactions: {
        Row: {
          amount: number
          bank_account_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          competence_date: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          description: string
          direction: string
          document: string | null
          id: string
          legal_entity_id: string | null
          notes: string | null
          payable_id: string | null
          project_id: string | null
          receivable_id: string | null
          reconciled_by: string | null
          reconciliation_date: string | null
          reconciliation_reference: string | null
          source_id: string | null
          source_system: string | null
          status: string
          transaction_date: string
          transaction_type: string
          transfer_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          competence_date?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          direction: string
          document?: string | null
          id?: string
          legal_entity_id?: string | null
          notes?: string | null
          payable_id?: string | null
          project_id?: string | null
          receivable_id?: string | null
          reconciled_by?: string | null
          reconciliation_date?: string | null
          reconciliation_reference?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          transaction_date: string
          transaction_type: string
          transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          competence_date?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          direction?: string
          document?: string | null
          id?: string
          legal_entity_id?: string | null
          notes?: string | null
          payable_id?: string | null
          project_id?: string | null
          receivable_id?: string | null
          reconciled_by?: string | null
          reconciliation_date?: string | null
          reconciliation_reference?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          transaction_date?: string
          transaction_type?: string
          transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transactions_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_bank_transfers: {
        Row: {
          amount: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_transaction_id: string | null
          debit_transaction_id: string | null
          description: string | null
          from_account_id: string
          id: string
          project_id: string | null
          status: string
          to_account_id: string
          transfer_date: string
          updated_at: string
        }
        Insert: {
          amount: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          credit_transaction_id?: string | null
          debit_transaction_id?: string | null
          description?: string | null
          from_account_id: string
          id?: string
          project_id?: string | null
          status?: string
          to_account_id: string
          transfer_date: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          credit_transaction_id?: string | null
          debit_transaction_id?: string | null
          description?: string | null
          from_account_id?: string
          id?: string
          project_id?: string | null
          status?: string
          to_account_id?: string
          transfer_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_bank_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_credit_transaction_fk"
            columns: ["credit_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_debit_transaction_fk"
            columns: ["debit_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_electronic_invoice_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          invoice_id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          invoice_id: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          invoice_id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_electronic_invoice_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_audit_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_electronic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_electronic_invoice_divergences: {
        Row: {
          actual_value: string | null
          company_id: string
          created_at: string
          description: string
          divergence_type: string
          expected_value: string | null
          id: string
          invoice_id: string
          invoice_item_id: string | null
          match_snapshot: Json
          project_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          rule_key: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          actual_value?: string | null
          company_id: string
          created_at?: string
          description: string
          divergence_type: string
          expected_value?: string | null
          id?: string
          invoice_id: string
          invoice_item_id?: string | null
          match_snapshot?: Json
          project_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rule_key?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          actual_value?: string | null
          company_id?: string
          created_at?: string
          description?: string
          divergence_type?: string
          expected_value?: string | null
          id?: string
          invoice_id?: string
          invoice_item_id?: string | null
          match_snapshot?: Json
          project_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rule_key?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_electronic_invoice_divergences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_divergences_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_electronic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_divergences_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "finance_electronic_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_divergences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_divergences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_divergences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_electronic_invoice_installments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          due_date: string
          id: string
          installment_label: string
          invoice_id: string
          payable_id: string | null
          payment_method: string | null
          project_id: string
          sequence_no: number
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_label: string
          invoice_id: string
          payable_id?: string | null
          payment_method?: string | null
          project_id: string
          sequence_no: number
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_label?: string
          invoice_id?: string
          payable_id?: string | null
          payment_method?: string | null
          project_id?: string
          sequence_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_electronic_invoice_installments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_installments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_electronic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_installments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_electronic_invoice_items: {
        Row: {
          cfop: string | null
          cofins_amount: number
          company_id: string
          cost_center_service_id: string | null
          created_at: string
          description: string
          discount_amount: number
          ean: string | null
          freight_amount: number
          gross_amount: number
          icms_amount: number
          id: string
          input_id: string | null
          invoice_id: string
          invoiceable_quantity: number | null
          ipi_amount: number
          line_number: number
          mapping_status: string
          ncm: string | null
          notes: string | null
          order_item_id: string | null
          order_quantity: number | null
          order_unit_price: number | null
          other_amount: number
          pis_amount: number
          previously_invoiced_quantity: number
          project_id: string
          quantity: number
          quantity_variance: number | null
          receipt_item_id: string | null
          receipt_quantity: number | null
          receipt_unit_cost: number | null
          supplier_product_code: string | null
          three_way_status: string
          total_amount: number
          unit_price: number
          unit_price_variance: number | null
          unit_snapshot: string | null
          updated_at: string
        }
        Insert: {
          cfop?: string | null
          cofins_amount?: number
          company_id: string
          cost_center_service_id?: string | null
          created_at?: string
          description: string
          discount_amount?: number
          ean?: string | null
          freight_amount?: number
          gross_amount: number
          icms_amount?: number
          id?: string
          input_id?: string | null
          invoice_id: string
          invoiceable_quantity?: number | null
          ipi_amount?: number
          line_number: number
          mapping_status?: string
          ncm?: string | null
          notes?: string | null
          order_item_id?: string | null
          order_quantity?: number | null
          order_unit_price?: number | null
          other_amount?: number
          pis_amount?: number
          previously_invoiced_quantity?: number
          project_id: string
          quantity: number
          quantity_variance?: number | null
          receipt_item_id?: string | null
          receipt_quantity?: number | null
          receipt_unit_cost?: number | null
          supplier_product_code?: string | null
          three_way_status?: string
          total_amount: number
          unit_price: number
          unit_price_variance?: number | null
          unit_snapshot?: string | null
          updated_at?: string
        }
        Update: {
          cfop?: string | null
          cofins_amount?: number
          company_id?: string
          cost_center_service_id?: string | null
          created_at?: string
          description?: string
          discount_amount?: number
          ean?: string | null
          freight_amount?: number
          gross_amount?: number
          icms_amount?: number
          id?: string
          input_id?: string | null
          invoice_id?: string
          invoiceable_quantity?: number | null
          ipi_amount?: number
          line_number?: number
          mapping_status?: string
          ncm?: string | null
          notes?: string | null
          order_item_id?: string | null
          order_quantity?: number | null
          order_unit_price?: number | null
          other_amount?: number
          pis_amount?: number
          previously_invoiced_quantity?: number
          project_id?: string
          quantity?: number
          quantity_variance?: number | null
          receipt_item_id?: string | null
          receipt_quantity?: number | null
          receipt_unit_cost?: number | null
          supplier_product_code?: string | null
          three_way_status?: string
          total_amount?: number
          unit_price?: number
          unit_price_variance?: number | null
          unit_snapshot?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_electronic_invoice_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_cost_center_service_id_fkey"
            columns: ["cost_center_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_electronic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoice_items_receipt_item_id_fkey"
            columns: ["receipt_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipt_items"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_electronic_invoices: {
        Row: {
          access_key: string
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cofins_amount: number
          company_id: string
          created_at: string
          discount_amount: number
          divergence_count: number
          freight_amount: number
          icms_amount: number
          id: string
          import_tax_amount: number
          imported_at: string
          imported_by: string | null
          insurance_amount: number
          invoice_number: string
          invoice_total: number
          ipi_amount: number
          issue_date: string
          issue_datetime: string | null
          issuer_name: string
          issuer_state_registration: string | null
          issuer_tax_id: string
          issuer_trade_name: string | null
          item_count: number
          legal_entity_id: string | null
          mapped_item_count: number
          model: string
          operation_nature: string | null
          order_id: string | null
          other_amount: number
          payment_total: number
          pis_amount: number
          products_amount: number
          project_id: string
          receipt_id: string | null
          recipient_name: string | null
          recipient_tax_id: string | null
          registry_number: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          sequence_no: number
          series: string | null
          status: string
          supplier_id: string
          three_way_checked_at: string | null
          three_way_status: string
          updated_at: string
          validation_status: string
          xml_file_name: string
          xml_hash: string
          xml_storage_path: string
        }
        Insert: {
          access_key: string
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cofins_amount?: number
          company_id: string
          created_at?: string
          discount_amount?: number
          divergence_count?: number
          freight_amount?: number
          icms_amount?: number
          id?: string
          import_tax_amount?: number
          imported_at?: string
          imported_by?: string | null
          insurance_amount?: number
          invoice_number: string
          invoice_total: number
          ipi_amount?: number
          issue_date: string
          issue_datetime?: string | null
          issuer_name: string
          issuer_state_registration?: string | null
          issuer_tax_id: string
          issuer_trade_name?: string | null
          item_count?: number
          legal_entity_id?: string | null
          mapped_item_count?: number
          model: string
          operation_nature?: string | null
          order_id?: string | null
          other_amount?: number
          payment_total?: number
          pis_amount?: number
          products_amount?: number
          project_id: string
          receipt_id?: string | null
          recipient_name?: string | null
          recipient_tax_id?: string | null
          registry_number: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sequence_no: number
          series?: string | null
          status?: string
          supplier_id: string
          three_way_checked_at?: string | null
          three_way_status?: string
          updated_at?: string
          validation_status?: string
          xml_file_name: string
          xml_hash: string
          xml_storage_path: string
        }
        Update: {
          access_key?: string
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cofins_amount?: number
          company_id?: string
          created_at?: string
          discount_amount?: number
          divergence_count?: number
          freight_amount?: number
          icms_amount?: number
          id?: string
          import_tax_amount?: number
          imported_at?: string
          imported_by?: string | null
          insurance_amount?: number
          invoice_number?: string
          invoice_total?: number
          ipi_amount?: number
          issue_date?: string
          issue_datetime?: string | null
          issuer_name?: string
          issuer_state_registration?: string | null
          issuer_tax_id?: string
          issuer_trade_name?: string | null
          item_count?: number
          legal_entity_id?: string | null
          mapped_item_count?: number
          model?: string
          operation_nature?: string | null
          order_id?: string | null
          other_amount?: number
          payment_total?: number
          pis_amount?: number
          products_amount?: number
          project_id?: string
          receipt_id?: string | null
          recipient_name?: string | null
          recipient_tax_id?: string | null
          registry_number?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sequence_no?: number
          series?: string | null
          status?: string
          supplier_id?: string
          three_way_checked_at?: string | null
          three_way_status?: string
          updated_at?: string
          validation_status?: string
          xml_file_name?: string
          xml_hash?: string
          xml_storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_electronic_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_electronic_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_manual_invoice_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          invoice_id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          invoice_id: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          invoice_id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_manual_invoice_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_audit_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_manual_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_manual_invoice_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          invoice_id: string
          mime_type: string | null
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          invoice_id: string
          mime_type?: string | null
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          invoice_id?: string
          mime_type?: string | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_manual_invoice_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_manual_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_manual_invoice_installments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          due_date: string
          id: string
          installment_label: string
          invoice_id: string
          payable_id: string | null
          payment_method: string | null
          project_id: string
          sequence_no: number
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_label: string
          invoice_id: string
          payable_id?: string | null
          payment_method?: string | null
          project_id: string
          sequence_no: number
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_label?: string
          invoice_id?: string
          payable_id?: string | null
          payment_method?: string | null
          project_id?: string
          sequence_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_manual_invoice_installments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_installments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_manual_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_installments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_installments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_manual_invoice_items: {
        Row: {
          company_id: string
          contract_item_id: string | null
          created_at: string
          description: string | null
          discount_amount: number
          gross_amount: number
          id: string
          invoice_id: string
          line_number: number
          measurement_item_id: string | null
          notes: string | null
          project_id: string
          quantity: number
          service_code: string
          service_id: string
          service_name: string
          total_amount: number
          unit_price: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contract_item_id?: string | null
          created_at?: string
          description?: string | null
          discount_amount?: number
          gross_amount: number
          id?: string
          invoice_id: string
          line_number: number
          measurement_item_id?: string | null
          notes?: string | null
          project_id: string
          quantity: number
          service_code: string
          service_id: string
          service_name: string
          total_amount: number
          unit_price: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contract_item_id?: string | null
          created_at?: string
          description?: string | null
          discount_amount?: number
          gross_amount?: number
          id?: string
          invoice_id?: string
          line_number?: number
          measurement_item_id?: string | null
          notes?: string | null
          project_id?: string
          quantity?: number
          service_code?: string
          service_id?: string
          service_name?: string
          total_amount?: number
          unit_price?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_manual_invoice_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_contract_item_id_fkey"
            columns: ["contract_item_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contract_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_manual_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_measurement_item_id_fkey"
            columns: ["measurement_item_id"]
            isOneToOne: false
            referencedRelation: "execution_contract_measurement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoice_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_manual_invoices: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cofins_amount: number
          company_id: string
          competence_date: string | null
          contract_id: string | null
          created_at: string
          created_by: string | null
          csll_amount: number
          document_number: string
          document_type: string
          gross_amount: number
          id: string
          inss_amount: number
          irrf_amount: number
          iss_amount: number
          issue_date: string
          item_count: number
          item_discount_amount: number
          legal_entity_id: string | null
          material_receipt_id: string | null
          measurement_id: string | null
          net_amount: number
          notes: string | null
          other_retention_amount: number
          payment_total: number
          pis_amount: number
          posted_at: string | null
          posted_by: string | null
          project_id: string
          registry_number: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          sequence_no: number
          series: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          supplier_id: string
          total_retention_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cofins_amount?: number
          company_id: string
          competence_date?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          csll_amount?: number
          document_number: string
          document_type: string
          gross_amount?: number
          id?: string
          inss_amount?: number
          irrf_amount?: number
          iss_amount?: number
          issue_date: string
          item_count?: number
          item_discount_amount?: number
          legal_entity_id?: string | null
          material_receipt_id?: string | null
          measurement_id?: string | null
          net_amount?: number
          notes?: string | null
          other_retention_amount?: number
          payment_total?: number
          pis_amount?: number
          posted_at?: string | null
          posted_by?: string | null
          project_id: string
          registry_number: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sequence_no: number
          series?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id: string
          total_retention_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cofins_amount?: number
          company_id?: string
          competence_date?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          csll_amount?: number
          document_number?: string
          document_type?: string
          gross_amount?: number
          id?: string
          inss_amount?: number
          irrf_amount?: number
          iss_amount?: number
          issue_date?: string
          item_count?: number
          item_discount_amount?: number
          legal_entity_id?: string | null
          material_receipt_id?: string | null
          measurement_id?: string | null
          net_amount?: number
          notes?: string | null
          other_retention_amount?: number
          payment_total?: number
          pis_amount?: number
          posted_at?: string | null
          posted_by?: string | null
          project_id?: string
          registry_number?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sequence_no?: number
          series?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id?: string
          total_retention_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_manual_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "execution_service_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_material_receipt_id_fkey"
            columns: ["material_receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "execution_contract_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_manual_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sefaz_connections: {
        Row: {
          certificate_expires_at: string | null
          certificate_file_name: string
          certificate_password_encrypted: string
          certificate_storage_path: string
          company_id: string
          created_at: string
          created_by: string | null
          environment: string
          id: string
          last_nsu: string
          last_status_code: string | null
          last_status_message: string | null
          last_sync_at: string | null
          legal_entity_id: string
          max_nsu: string
          state_code: string
          status: string
          tax_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          certificate_expires_at?: string | null
          certificate_file_name: string
          certificate_password_encrypted: string
          certificate_storage_path: string
          company_id: string
          created_at?: string
          created_by?: string | null
          environment?: string
          id?: string
          last_nsu?: string
          last_status_code?: string | null
          last_status_message?: string | null
          last_sync_at?: string | null
          legal_entity_id: string
          max_nsu?: string
          state_code: string
          status?: string
          tax_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          certificate_expires_at?: string | null
          certificate_file_name?: string
          certificate_password_encrypted?: string
          certificate_storage_path?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          environment?: string
          id?: string
          last_nsu?: string
          last_status_code?: string | null
          last_status_message?: string | null
          last_sync_at?: string | null
          legal_entity_id?: string
          max_nsu?: string
          state_code?: string
          status?: string
          tax_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sefaz_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sefaz_connections_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sefaz_documents: {
        Row: {
          access_key: string | null
          company_id: string
          connection_id: string
          document_kind: string
          first_seen_at: string
          id: string
          imported_invoice_id: string | null
          issue_datetime: string | null
          issuer_name: string | null
          issuer_tax_id: string | null
          legal_entity_id: string
          nsu: string
          processing_status: string
          raw_summary: Json
          schema_name: string
          sefaz_document_status: string | null
          total_amount: number | null
          updated_at: string
          xml_storage_path: string | null
        }
        Insert: {
          access_key?: string | null
          company_id: string
          connection_id: string
          document_kind?: string
          first_seen_at?: string
          id?: string
          imported_invoice_id?: string | null
          issue_datetime?: string | null
          issuer_name?: string | null
          issuer_tax_id?: string | null
          legal_entity_id: string
          nsu: string
          processing_status?: string
          raw_summary?: Json
          schema_name: string
          sefaz_document_status?: string | null
          total_amount?: number | null
          updated_at?: string
          xml_storage_path?: string | null
        }
        Update: {
          access_key?: string | null
          company_id?: string
          connection_id?: string
          document_kind?: string
          first_seen_at?: string
          id?: string
          imported_invoice_id?: string | null
          issue_datetime?: string | null
          issuer_name?: string | null
          issuer_tax_id?: string | null
          legal_entity_id?: string
          nsu?: string
          processing_status?: string
          raw_summary?: Json
          schema_name?: string
          sefaz_document_status?: string | null
          total_amount?: number | null
          updated_at?: string
          xml_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sefaz_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sefaz_documents_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "finance_sefaz_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sefaz_documents_imported_invoice_id_fkey"
            columns: ["imported_invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_electronic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sefaz_documents_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sefaz_sync_logs: {
        Row: {
          company_id: string
          connection_id: string
          created_by: string | null
          documents_received: number
          error_message: string | null
          final_nsu: string | null
          finished_at: string | null
          full_xml_received: number
          id: string
          legal_entity_id: string
          max_nsu: string | null
          start_nsu: string
          started_at: string
          status: string
          status_code: string | null
          status_message: string | null
        }
        Insert: {
          company_id: string
          connection_id: string
          created_by?: string | null
          documents_received?: number
          error_message?: string | null
          final_nsu?: string | null
          finished_at?: string | null
          full_xml_received?: number
          id?: string
          legal_entity_id: string
          max_nsu?: string | null
          start_nsu: string
          started_at?: string
          status?: string
          status_code?: string | null
          status_message?: string | null
        }
        Update: {
          company_id?: string
          connection_id?: string
          created_by?: string | null
          documents_received?: number
          error_message?: string | null
          final_nsu?: string | null
          finished_at?: string | null
          full_xml_received?: number
          id?: string
          legal_entity_id?: string
          max_nsu?: string | null
          start_nsu?: string
          started_at?: string
          status?: string
          status_code?: string | null
          status_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sefaz_sync_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sefaz_sync_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "finance_sefaz_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sefaz_sync_logs_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_supplier_product_mappings: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description_normalized: string
          description_snapshot: string
          ean: string | null
          first_seen_at: string
          id: string
          input_id: string
          last_used_at: string
          product_key: string
          supplier_id: string
          supplier_product_code: string | null
          updated_at: string
          updated_by: string | null
          use_count: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description_normalized: string
          description_snapshot: string
          ean?: string | null
          first_seen_at?: string
          id?: string
          input_id: string
          last_used_at?: string
          product_key: string
          supplier_id: string
          supplier_product_code?: string | null
          updated_at?: string
          updated_by?: string | null
          use_count?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description_normalized?: string
          description_snapshot?: string
          ean?: string | null
          first_seen_at?: string
          id?: string
          input_id?: string
          last_used_at?: string
          product_key?: string
          supplier_id?: string
          supplier_product_code?: string | null
          updated_at?: string
          updated_by?: string | null
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_supplier_product_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_supplier_product_mappings_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_supplier_product_mappings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_supplier_product_mappings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_supplier_product_mappings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_tax_obligations: {
        Row: {
          barcode: string | null
          company_id: string
          competence_date: string
          created_at: string
          created_by: string | null
          discount_amount: number
          document_number: string | null
          due_date: string
          id: string
          interest_amount: number
          manual_invoice_id: string | null
          notes: string | null
          other_amount: number
          paid_amount: number | null
          paid_at: string | null
          payable_id: string | null
          payment_code: string | null
          penalty_amount: number
          principal_amount: number
          project_id: string
          reference: string
          retention_key: string | null
          source_id: string | null
          source_system: string | null
          status: string
          tax_type_id: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          company_id: string
          competence_date: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          document_number?: string | null
          due_date: string
          id?: string
          interest_amount?: number
          manual_invoice_id?: string | null
          notes?: string | null
          other_amount?: number
          paid_amount?: number | null
          paid_at?: string | null
          payable_id?: string | null
          payment_code?: string | null
          penalty_amount?: number
          principal_amount?: number
          project_id: string
          reference?: string
          retention_key?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          tax_type_id: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          company_id?: string
          competence_date?: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          document_number?: string | null
          due_date?: string
          id?: string
          interest_amount?: number
          manual_invoice_id?: string | null
          notes?: string | null
          other_amount?: number
          paid_amount?: number | null
          paid_at?: string | null
          payable_id?: string | null
          payment_code?: string | null
          penalty_amount?: number
          principal_amount?: number
          project_id?: string
          reference?: string
          retention_key?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          tax_type_id?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_obligations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_obligations_manual_invoice_id_fkey"
            columns: ["manual_invoice_id"]
            isOneToOne: false
            referencedRelation: "finance_manual_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_obligations_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_tax_obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_tax_obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_obligations_tax_type_id_fkey"
            columns: ["tax_type_id"]
            isOneToOne: false
            referencedRelation: "finance_tax_types"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_tax_types: {
        Row: {
          authority_supplier_id: string
          auto_generate_payable: boolean
          business_day_adjustment: string
          category: string
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          document_prefix: string | null
          due_day: number | null
          due_days_after_event: number
          due_month_offset: number
          due_rule: string
          due_trigger: string
          fiscal_class: string | null
          id: string
          name: string
          notes: string | null
          payment_method: string | null
          project_id: string | null
          retention_key: string | null
          status: string
          updated_at: string
        }
        Insert: {
          authority_supplier_id: string
          auto_generate_payable?: boolean
          business_day_adjustment?: string
          category?: string
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          document_prefix?: string | null
          due_day?: number | null
          due_days_after_event?: number
          due_month_offset?: number
          due_rule?: string
          due_trigger?: string
          fiscal_class?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_method?: string | null
          project_id?: string | null
          retention_key?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          authority_supplier_id?: string
          auto_generate_payable?: boolean
          business_day_adjustment?: string
          category?: string
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          document_prefix?: string | null
          due_day?: number | null
          due_days_after_event?: number
          due_month_offset?: number
          due_rule?: string
          due_trigger?: string
          fiscal_class?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_method?: string | null
          project_id?: string | null
          retention_key?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_tax_types_authority_supplier_id_fkey"
            columns: ["authority_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_tax_types_authority_supplier_id_fkey"
            columns: ["authority_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "finance_tax_types_authority_supplier_id_fkey"
            columns: ["authority_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tax_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_tax_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_tax_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_three_way_match_settings: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          price_absolute_tolerance: number
          price_percent_tolerance: number
          project_id: string | null
          quantity_tolerance: number
          require_order: boolean
          require_receipt: boolean
          total_absolute_tolerance: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          price_absolute_tolerance?: number
          price_percent_tolerance?: number
          project_id?: string | null
          quantity_tolerance?: number
          require_order?: boolean
          require_receipt?: boolean
          total_absolute_tolerance?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          price_absolute_tolerance?: number
          price_percent_tolerance?: number
          project_id?: string | null
          quantity_tolerance?: number
          require_order?: boolean
          require_receipt?: boolean
          total_absolute_tolerance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_three_way_match_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_three_way_match_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_three_way_match_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_three_way_match_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_snapshot_rows: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          id: string
          layer: string
          month: string
          project_id: string
          service_budget_amount: number
          service_code: string | null
          service_id: string | null
          service_key: string
          service_name: string
          snapshot_id: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          id?: string
          layer: string
          month: string
          project_id: string
          service_budget_amount: number
          service_code?: string | null
          service_id?: string | null
          service_key: string
          service_name: string
          snapshot_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          id?: string
          layer?: string
          month?: string
          project_id?: string
          service_budget_amount?: number
          service_code?: string | null
          service_id?: string | null
          service_key?: string
          service_name?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_snapshot_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshot_rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "forecast_snapshot_rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "forecast_snapshot_rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshot_rows_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshot_rows_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "forecast_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_snapshots: {
        Row: {
          actual_total: number
          archived_at: string | null
          archived_by: string | null
          baseline_id: string | null
          baseline_label: string | null
          budget_id: string | null
          budget_label: string | null
          budget_total: number
          captured_at: string
          committed_total: number
          company_id: string
          created_by: string | null
          default_payment_days: number
          deviation_total: number
          engine_version: string
          forecast_as_of_date: string
          id: string
          project_id: string
          projected_cost_total: number
          reference_month: string
          source: string
          to_commit_total: number
          warnings: Json
        }
        Insert: {
          actual_total: number
          archived_at?: string | null
          archived_by?: string | null
          baseline_id?: string | null
          baseline_label?: string | null
          budget_id?: string | null
          budget_label?: string | null
          budget_total: number
          captured_at?: string
          committed_total: number
          company_id: string
          created_by?: string | null
          default_payment_days: number
          deviation_total: number
          engine_version: string
          forecast_as_of_date: string
          id?: string
          project_id: string
          projected_cost_total: number
          reference_month: string
          source?: string
          to_commit_total: number
          warnings?: Json
        }
        Update: {
          actual_total?: number
          archived_at?: string | null
          archived_by?: string | null
          baseline_id?: string | null
          baseline_label?: string | null
          budget_id?: string | null
          budget_label?: string | null
          budget_total?: number
          captured_at?: string
          committed_total?: number
          company_id?: string
          created_by?: string | null
          default_payment_days?: number
          deviation_total?: number
          engine_version?: string
          forecast_as_of_date?: string
          id?: string
          project_id?: string
          projected_cost_total?: number
          reference_month?: string
          source?: string
          to_commit_total?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "forecast_snapshots_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "engineering_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "forecast_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "forecast_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employees: {
        Row: {
          admission_date: string | null
          bank_account: string | null
          bank_branch: string | null
          bank_name: string | null
          base_salary: number
          company_id: string
          cost_center: string | null
          created_at: string
          created_by: string | null
          default_project_id: string | null
          employee_code: string
          employment_type: string
          full_name: string
          id: string
          notes: string | null
          pix_key: string | null
          position_title: string | null
          salary_due_day: number
          status: string
          tax_id: string | null
          termination_date: string | null
          updated_at: string
        }
        Insert: {
          admission_date?: string | null
          bank_account?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          base_salary?: number
          company_id: string
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          default_project_id?: string | null
          employee_code: string
          employment_type?: string
          full_name: string
          id?: string
          notes?: string | null
          pix_key?: string | null
          position_title?: string | null
          salary_due_day?: number
          status?: string
          tax_id?: string | null
          termination_date?: string | null
          updated_at?: string
        }
        Update: {
          admission_date?: string | null
          bank_account?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          base_salary?: number
          company_id?: string
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          default_project_id?: string | null
          employee_code?: string
          employment_type?: string
          full_name?: string
          id?: string
          notes?: string | null
          pix_key?: string | null
          position_title?: string | null
          salary_due_day?: number
          status?: string
          tax_id?: string | null
          termination_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employees_default_project_id_fkey"
            columns: ["default_project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_employees_default_project_id_fkey"
            columns: ["default_project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_employees_default_project_id_fkey"
            columns: ["default_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_entries: {
        Row: {
          base_salary: number
          company_id: string
          created_at: string
          deductions: number
          due_date: string
          earnings: number
          employee_id: string
          gross_salary: number | null
          id: string
          net_salary: number | null
          notes: string | null
          payroll_run_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          base_salary?: number
          company_id: string
          created_at?: string
          deductions?: number
          due_date: string
          earnings?: number
          employee_id: string
          gross_salary?: number | null
          id?: string
          net_salary?: number | null
          notes?: string | null
          payroll_run_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          base_salary?: number
          company_id?: string
          created_at?: string
          deductions?: number
          due_date?: string
          earnings?: number
          employee_id?: string
          gross_salary?: number | null
          id?: string
          net_salary?: number | null
          notes?: string | null
          payroll_run_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_entries_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "hr_payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_payroll_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_payroll_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_obligations: {
        Row: {
          amount: number
          beneficiary_name: string
          beneficiary_tax_id: string | null
          company_id: string
          created_at: string
          description: string
          due_date: string
          id: string
          notes: string | null
          obligation_code: string | null
          obligation_type: string
          payroll_run_id: string
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount: number
          beneficiary_name: string
          beneficiary_tax_id?: string | null
          company_id: string
          created_at?: string
          description: string
          due_date: string
          id?: string
          notes?: string | null
          obligation_code?: string | null
          obligation_type?: string
          payroll_run_id: string
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          beneficiary_name?: string
          beneficiary_tax_id?: string | null
          company_id?: string
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          obligation_code?: string | null
          obligation_type?: string
          payroll_run_id?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_obligations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_obligations_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "hr_payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_payroll_obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_payroll_obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_runs: {
        Row: {
          company_id: string
          competence: string
          created_at: string
          created_by: string | null
          deduction_amount: number
          gross_amount: number
          id: string
          net_amount: number
          notes: string | null
          obligations_amount: number
          posted_at: string | null
          posted_by: string | null
          project_id: string
          salary_due_date: string
          status: string
          total_company_cost: number
          updated_at: string
        }
        Insert: {
          company_id: string
          competence: string
          created_at?: string
          created_by?: string | null
          deduction_amount?: number
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          obligations_amount?: number
          posted_at?: string | null
          posted_by?: string | null
          project_id: string
          salary_due_date: string
          status?: string
          total_company_cost?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          competence?: string
          created_at?: string
          created_by?: string | null
          deduction_amount?: number
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          obligations_amount?: number
          posted_at?: string | null
          posted_by?: string | null
          project_id?: string
          salary_due_date?: string
          status?: string
          total_company_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_payroll_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hr_payroll_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      koper_staging_records: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          elos_id: string | null
          entity: string
          first_seen_at: string
          id: string
          koper_created_at: string | null
          koper_id: string
          koper_parent_id: string | null
          koper_updated_at: string | null
          last_seen_at: string
          mapping_version: number
          payload: Json
          payload_hash: string
          processing_error: string | null
          processing_status: string
          source: string
          sync_state: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          elos_id?: string | null
          entity: string
          first_seen_at?: string
          id?: string
          koper_created_at?: string | null
          koper_id: string
          koper_parent_id?: string | null
          koper_updated_at?: string | null
          last_seen_at?: string
          mapping_version: number
          payload: Json
          payload_hash: string
          processing_error?: string | null
          processing_status?: string
          source?: string
          sync_state?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          elos_id?: string | null
          entity?: string
          first_seen_at?: string
          id?: string
          koper_created_at?: string | null
          koper_id?: string
          koper_parent_id?: string | null
          koper_updated_at?: string | null
          last_seen_at?: string
          mapping_version?: number
          payload?: Json
          payload_hash?: string
          processing_error?: string | null
          processing_status?: string
          source?: string
          sync_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "koper_staging_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_entities: {
        Row: {
          address_number: string | null
          city: string | null
          cnpj: string | null
          company_id: string
          complement: string | null
          created_at: string
          created_by: string | null
          district: string | null
          email: string | null
          entity_type: string
          id: string
          is_primary: boolean
          legal_name: string
          municipal_registration: string | null
          notes: string | null
          parent_entity_id: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          state_registration: string | null
          status: string
          street: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          address_number?: string | null
          city?: string | null
          cnpj?: string | null
          company_id: string
          complement?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          email?: string | null
          entity_type?: string
          id?: string
          is_primary?: boolean
          legal_name: string
          municipal_registration?: string | null
          notes?: string | null
          parent_entity_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          state_registration?: string | null
          status?: string
          street?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          address_number?: string | null
          city?: string | null
          cnpj?: string | null
          company_id?: string
          complement?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          email?: string | null
          entity_type?: string
          id?: string
          is_primary?: boolean
          legal_name?: string
          municipal_registration?: string | null
          notes?: string | null
          parent_entity_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          state_registration?: string | null
          status?: string
          street?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_entities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_entities_parent_fk"
            columns: ["company_id", "parent_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      payables: {
        Row: {
          amount: number
          bank_account_id: string | null
          bank_transaction_id: string | null
          beneficiary_name: string | null
          beneficiary_tax_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          fiscal_class: string | null
          id: string
          installment_label: string | null
          notes: string | null
          origin: string
          paid_account_name: string | null
          paid_amount: number | null
          paid_at: string | null
          payment_method: string | null
          project_id: string
          source_category: string | null
          source_id: string | null
          source_system: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          bank_transaction_id?: string | null
          beneficiary_name?: string | null
          beneficiary_tax_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          document?: string | null
          due_date: string
          fiscal_class?: string | null
          id?: string
          installment_label?: string | null
          notes?: string | null
          origin?: string
          paid_account_name?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          project_id: string
          source_category?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          bank_transaction_id?: string | null
          beneficiary_name?: string | null
          beneficiary_tax_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          document?: string | null
          due_date?: string
          fiscal_class?: string | null
          id?: string
          installment_label?: string | null
          notes?: string | null
          origin?: string
          paid_account_name?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          project_id?: string
          source_category?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payables_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "payables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "payables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "payables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "payables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          created_at: string
          description: string
          key: string
          module: string
        }
        Insert: {
          action: string
          created_at?: string
          description: string
          key: string
          module: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          key?: string
          module?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          note: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_environment_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string | null
          company_name: string
          company_slug: string
          details: Json
          id: string
          owner_email: string
          owner_user_id: string | null
          project_id: string | null
          project_name: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string | null
          company_name: string
          company_slug: string
          details?: Json
          id?: string
          owner_email: string
          owner_user_id?: string | null
          project_id?: string | null
          project_name?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string | null
          company_name?: string
          company_slug?: string
          details?: Json
          id?: string
          owner_email?: string
          owner_user_id?: string | null
          project_id?: string | null
          project_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_environment_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_environment_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "platform_environment_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "platform_environment_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_assistance_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          new_status: string | null
          notes: string | null
          previous_status: string | null
          project_id: string
          ticket_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          project_id: string
          ticket_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          project_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_assistance_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_audit_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "postwork_assistance_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_assistance_counters: {
        Row: {
          company_id: string
          counter_year: number
          last_number: number
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          counter_year: number
          last_number?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          counter_year?: number
          last_number?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_assistance_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_assistance_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          project_id: string
          storage_path: string
          ticket_id: string
          uploaded_at: string
          uploaded_by: string | null
          visit_id: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          storage_path: string
          ticket_id: string
          uploaded_at?: string
          uploaded_by?: string | null
          visit_id?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          storage_path?: string
          ticket_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_assistance_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_documents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "postwork_assistance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_documents_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "postwork_assistance_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_assistance_tickets: {
        Row: {
          accepted_at: string | null
          accepted_by_name: string | null
          access_notes: string | null
          cancellation_reason: string | null
          category: string
          channel: string
          client_id: string | null
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          customer_charge: number
          customer_rating: number | null
          description: string
          diagnosis: string | null
          execution_notes: string | null
          id: string
          location_detail: string | null
          material_cost: number
          number: string
          opened_at: string
          priority: string
          project_id: string
          rejection_reason: string | null
          resolution_notes: string | null
          resolved_at: string | null
          responsible_name: string | null
          responsible_user_id: string | null
          sale_id: string | null
          scheduled_at: string | null
          scope_type: string
          sla_due_at: string | null
          status: string
          supplier_cost: number
          supplier_id: string | null
          title: string
          unit_id: string | null
          updated_at: string
          updated_by: string | null
          warranty_analysis_at: string | null
          warranty_analyzed_by: string | null
          warranty_asset_id: string | null
          warranty_claimed: boolean
          warranty_policy_id: string | null
          warranty_reason: string | null
          warranty_status: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_name?: string | null
          access_notes?: string | null
          cancellation_reason?: string | null
          category: string
          channel?: string
          client_id?: string | null
          company_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_charge?: number
          customer_rating?: number | null
          description: string
          diagnosis?: string | null
          execution_notes?: string | null
          id?: string
          location_detail?: string | null
          material_cost?: number
          number: string
          opened_at?: string
          priority?: string
          project_id: string
          rejection_reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          responsible_name?: string | null
          responsible_user_id?: string | null
          sale_id?: string | null
          scheduled_at?: string | null
          scope_type?: string
          sla_due_at?: string | null
          status?: string
          supplier_cost?: number
          supplier_id?: string | null
          title: string
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          warranty_analysis_at?: string | null
          warranty_analyzed_by?: string | null
          warranty_asset_id?: string | null
          warranty_claimed?: boolean
          warranty_policy_id?: string | null
          warranty_reason?: string | null
          warranty_status?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_name?: string | null
          access_notes?: string | null
          cancellation_reason?: string | null
          category?: string
          channel?: string
          client_id?: string | null
          company_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_charge?: number
          customer_rating?: number | null
          description?: string
          diagnosis?: string | null
          execution_notes?: string | null
          id?: string
          location_detail?: string | null
          material_cost?: number
          number?: string
          opened_at?: string
          priority?: string
          project_id?: string
          rejection_reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          responsible_name?: string | null
          responsible_user_id?: string | null
          sale_id?: string | null
          scheduled_at?: string | null
          scope_type?: string
          sla_due_at?: string | null
          status?: string
          supplier_cost?: number
          supplier_id?: string | null
          title?: string
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          warranty_analysis_at?: string | null
          warranty_analyzed_by?: string | null
          warranty_asset_id?: string | null
          warranty_claimed?: boolean
          warranty_policy_id?: string | null
          warranty_reason?: string | null
          warranty_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_assistance_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_warranty_asset_id_fkey"
            columns: ["warranty_asset_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_tickets_warranty_policy_id_fkey"
            columns: ["warranty_policy_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_assistance_visits: {
        Row: {
          company_id: string
          completed_by: string | null
          created_at: string
          created_by: string | null
          diagnosis: string | null
          finished_at: string | null
          id: string
          materials_used: string | null
          notes: string | null
          project_id: string
          requires_return: boolean
          return_recommendation: string | null
          scheduled_at: string
          service_performed: string | null
          started_at: string | null
          status: string
          supplier_id: string | null
          technician_name: string | null
          ticket_id: string
          updated_at: string
          visit_type: string
        }
        Insert: {
          company_id: string
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          finished_at?: string | null
          id?: string
          materials_used?: string | null
          notes?: string | null
          project_id: string
          requires_return?: boolean
          return_recommendation?: string | null
          scheduled_at: string
          service_performed?: string | null
          started_at?: string | null
          status?: string
          supplier_id?: string | null
          technician_name?: string | null
          ticket_id: string
          updated_at?: string
          visit_type?: string
        }
        Update: {
          company_id?: string
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          finished_at?: string | null
          id?: string
          materials_used?: string | null
          notes?: string | null
          project_id?: string
          requires_return?: boolean
          return_recommendation?: string | null
          scheduled_at?: string
          service_performed?: string | null
          started_at?: string | null
          status?: string
          supplier_id?: string | null
          technician_name?: string | null
          ticket_id?: string
          updated_at?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_assistance_visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_assistance_visits_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "postwork_assistance_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_inspection_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          inspection_id: string
          inspection_item_id: string | null
          new_status: string | null
          notes: string | null
          previous_status: string | null
          project_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          inspection_id: string
          inspection_item_id?: string | null
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          project_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          inspection_id?: string
          inspection_item_id?: string | null
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_inspection_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_audit_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "postwork_unit_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_audit_inspection_item_id_fkey"
            columns: ["inspection_item_id"]
            isOneToOne: false
            referencedRelation: "postwork_unit_inspection_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_inspection_counters: {
        Row: {
          company_id: string
          counter_year: number
          last_number: number
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          counter_year: number
          last_number?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          counter_year?: number
          last_number?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_inspection_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_inspection_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          inspection_id: string
          inspection_item_id: string | null
          mime_type: string | null
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          inspection_id: string
          inspection_item_id?: string | null
          mime_type?: string | null
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          inspection_id?: string
          inspection_item_id?: string | null
          mime_type?: string | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_inspection_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_documents_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "postwork_unit_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_documents_inspection_item_id_fkey"
            columns: ["inspection_item_id"]
            isOneToOne: false
            referencedRelation: "postwork_unit_inspection_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_inspection_template_items: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          criterion: string | null
          environment: string
          id: string
          is_mandatory: boolean
          project_id: string | null
          sort_order: number
          template_id: string
          title: string
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          criterion?: string | null
          environment: string
          id?: string
          is_mandatory?: boolean
          project_id?: string | null
          sort_order?: number
          template_id: string
          title: string
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          criterion?: string | null
          environment?: string
          id?: string
          is_mandatory?: boolean
          project_id?: string | null
          sort_order?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_inspection_template_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_template_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_template_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_template_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "postwork_inspection_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_inspection_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          inspection_type: string
          instructions: string | null
          name: string
          project_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string
          instructions?: string | null
          name: string
          project_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string
          instructions?: string | null
          name?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "postwork_inspection_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_inspection_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_inspection_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_unit_inspection_items: {
        Row: {
          assistance_ticket_id: string | null
          code: string | null
          company_id: string
          corrected_at: string | null
          corrected_by: string | null
          correction_due_date: string | null
          correction_notes: string | null
          correction_responsible_name: string | null
          correction_status: string
          created_at: string
          criterion: string | null
          environment: string
          id: string
          inspection_id: string
          is_mandatory: boolean
          notes: string | null
          project_id: string
          result: string
          sort_order: number
          supplier_id: string | null
          template_item_id: string | null
          title: string
          updated_at: string
          verification_notes: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          assistance_ticket_id?: string | null
          code?: string | null
          company_id: string
          corrected_at?: string | null
          corrected_by?: string | null
          correction_due_date?: string | null
          correction_notes?: string | null
          correction_responsible_name?: string | null
          correction_status?: string
          created_at?: string
          criterion?: string | null
          environment: string
          id?: string
          inspection_id: string
          is_mandatory?: boolean
          notes?: string | null
          project_id: string
          result?: string
          sort_order?: number
          supplier_id?: string | null
          template_item_id?: string | null
          title: string
          updated_at?: string
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          assistance_ticket_id?: string | null
          code?: string | null
          company_id?: string
          corrected_at?: string | null
          corrected_by?: string | null
          correction_due_date?: string | null
          correction_notes?: string | null
          correction_responsible_name?: string | null
          correction_status?: string
          created_at?: string
          criterion?: string | null
          environment?: string
          id?: string
          inspection_id?: string
          is_mandatory?: boolean
          notes?: string | null
          project_id?: string
          result?: string
          sort_order?: number
          supplier_id?: string | null
          template_item_id?: string | null
          title?: string
          updated_at?: string
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_unit_inspection_items_assistance_ticket_id_fkey"
            columns: ["assistance_ticket_id"]
            isOneToOne: false
            referencedRelation: "postwork_assistance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "postwork_unit_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspection_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "postwork_inspection_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_unit_inspections: {
        Row: {
          accepted_at: string | null
          accepted_by_document: string | null
          accepted_by_name: string | null
          access_notes: string | null
          approved_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          client_id: string | null
          company_id: string
          completed_at: string | null
          contact_phone: string | null
          correction_notes: string | null
          created_at: string
          created_by: string | null
          customer_attendee_document: string | null
          customer_attendee_name: string | null
          customer_rating: number | null
          delivered_at: string | null
          delivery_notes: string | null
          energy_meter_reading: string | null
          gas_meter_reading: string | null
          general_notes: string | null
          id: string
          inspection_type: string
          inspector_name: string | null
          keys_delivered: number
          number: string
          project_id: string
          sale_id: string | null
          scheduled_at: string | null
          sequence_no: number
          started_at: string | null
          status: string
          tags_delivered: number
          template_id: string | null
          unit_id: string
          updated_at: string
          updated_by: string | null
          water_meter_reading: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_document?: string | null
          accepted_by_name?: string | null
          access_notes?: string | null
          approved_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          company_id: string
          completed_at?: string | null
          contact_phone?: string | null
          correction_notes?: string | null
          created_at?: string
          created_by?: string | null
          customer_attendee_document?: string | null
          customer_attendee_name?: string | null
          customer_rating?: number | null
          delivered_at?: string | null
          delivery_notes?: string | null
          energy_meter_reading?: string | null
          gas_meter_reading?: string | null
          general_notes?: string | null
          id?: string
          inspection_type?: string
          inspector_name?: string | null
          keys_delivered?: number
          number: string
          project_id: string
          sale_id?: string | null
          scheduled_at?: string | null
          sequence_no: number
          started_at?: string | null
          status?: string
          tags_delivered?: number
          template_id?: string | null
          unit_id: string
          updated_at?: string
          updated_by?: string | null
          water_meter_reading?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by_document?: string | null
          accepted_by_name?: string | null
          access_notes?: string | null
          approved_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          company_id?: string
          completed_at?: string | null
          contact_phone?: string | null
          correction_notes?: string | null
          created_at?: string
          created_by?: string | null
          customer_attendee_document?: string | null
          customer_attendee_name?: string | null
          customer_rating?: number | null
          delivered_at?: string | null
          delivery_notes?: string | null
          energy_meter_reading?: string | null
          gas_meter_reading?: string | null
          general_notes?: string | null
          id?: string
          inspection_type?: string
          inspector_name?: string | null
          keys_delivered?: number
          number?: string
          project_id?: string
          sale_id?: string | null
          scheduled_at?: string | null
          sequence_no?: number
          started_at?: string | null
          status?: string
          tags_delivered?: number
          template_id?: string | null
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
          water_meter_reading?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_unit_inspections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "postwork_inspection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_unit_inspections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_warranty_assets: {
        Row: {
          asset_code: string
          brand: string | null
          cancellation_reason: string | null
          company_id: string
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          installation_date: string | null
          invoice_number: string | null
          item_name: string
          location_detail: string | null
          model: string | null
          notes: string | null
          policy_id: string
          project_id: string
          purchase_date: string | null
          sale_id: string | null
          serial_number: string | null
          start_date: string
          status: string
          supplier_id: string | null
          unit_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_code: string
          brand?: string | null
          cancellation_reason?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          installation_date?: string | null
          invoice_number?: string | null
          item_name: string
          location_detail?: string | null
          model?: string | null
          notes?: string | null
          policy_id: string
          project_id: string
          purchase_date?: string | null
          sale_id?: string | null
          serial_number?: string | null
          start_date: string
          status?: string
          supplier_id?: string | null
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_code?: string
          brand?: string | null
          cancellation_reason?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          installation_date?: string | null
          invoice_number?: string | null
          item_name?: string
          location_detail?: string | null
          model?: string | null
          notes?: string | null
          policy_id?: string
          project_id?: string
          purchase_date?: string | null
          sale_id?: string | null
          serial_number?: string | null
          start_date?: string
          status?: string
          supplier_id?: string | null
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_warranty_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_assets_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_warranty_audit: {
        Row: {
          action: string
          asset_id: string | null
          assistance_ticket_id: string | null
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          maintenance_id: string | null
          notes: string | null
          policy_id: string | null
          project_id: string | null
        }
        Insert: {
          action: string
          asset_id?: string | null
          assistance_ticket_id?: string | null
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          maintenance_id?: string | null
          notes?: string | null
          policy_id?: string | null
          project_id?: string | null
        }
        Update: {
          action?: string
          asset_id?: string | null
          assistance_ticket_id?: string | null
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          maintenance_id?: string | null
          notes?: string | null
          policy_id?: string | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_warranty_audit_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_assistance_ticket_id_fkey"
            columns: ["assistance_ticket_id"]
            isOneToOne: false
            referencedRelation: "postwork_assistance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_maintenance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_warranty_counters: {
        Row: {
          company_id: string
          counter_year: number
          last_number: number
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          counter_year: number
          last_number?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          counter_year?: number
          last_number?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_warranty_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_counters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_warranty_documents: {
        Row: {
          asset_id: string | null
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          maintenance_id: string | null
          mime_type: string | null
          policy_id: string | null
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          asset_id?: string | null
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          maintenance_id?: string | null
          mime_type?: string | null
          policy_id?: string | null
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          asset_id?: string | null
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          maintenance_id?: string | null
          mime_type?: string | null
          policy_id?: string | null
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_warranty_documents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_documents_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_maintenance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_documents_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_warranty_maintenance: {
        Row: {
          asset_id: string
          cancellation_reason: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          cost: number
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          project_id: string
          status: string
          supplier_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          cancellation_reason?: string | null
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          cost?: number
          created_at?: string
          created_by?: string | null
          due_date: string
          id?: string
          project_id: string
          status?: string
          supplier_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          cancellation_reason?: string | null
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          cost?: number
          created_at?: string
          created_by?: string | null
          due_date?: string
          id?: string
          project_id?: string
          status?: string
          supplier_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postwork_warranty_maintenance_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "postwork_warranty_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_warranty_maintenance_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      postwork_warranty_policies: {
        Row: {
          alert_days: number
          category: string
          code: string
          company_id: string
          coverage_terms: string
          created_at: string
          created_by: string | null
          exclusions: string | null
          id: string
          maintenance_requirements: string | null
          manufacturer: string | null
          name: string
          project_id: string | null
          scope_type: string
          start_rule: string
          status: string
          supplier_id: string | null
          term_months: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_days?: number
          category?: string
          code: string
          company_id: string
          coverage_terms: string
          created_at?: string
          created_by?: string | null
          exclusions?: string | null
          id?: string
          maintenance_requirements?: string | null
          manufacturer?: string | null
          name: string
          project_id?: string | null
          scope_type?: string
          start_rule?: string
          status?: string
          supplier_id?: string | null
          term_months: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_days?: number
          category?: string
          code?: string
          company_id?: string
          coverage_terms?: string
          created_at?: string
          created_by?: string | null
          exclusions?: string | null
          id?: string
          maintenance_requirements?: string | null
          manufacturer?: string | null
          name?: string
          project_id?: string | null
          scope_type?: string
          start_rule?: string
          status?: string
          supplier_id?: string | null
          term_months?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postwork_warranty_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_policies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_policies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "postwork_warranty_policies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "postwork_warranty_policies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_warranty_policies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "postwork_warranty_policies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_cross_project_transfers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          destination_movement_id: string | null
          from_balance_id: string
          from_project_id: string
          id: string
          input_id: string
          notes: string | null
          quantity: number
          source_movement_id: string | null
          status: string
          to_location_id: string
          to_project_id: string
          unit_cost: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          destination_movement_id?: string | null
          from_balance_id: string
          from_project_id: string
          id?: string
          input_id: string
          notes?: string | null
          quantity: number
          source_movement_id?: string | null
          status?: string
          to_location_id: string
          to_project_id: string
          unit_cost?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          destination_movement_id?: string | null
          from_balance_id?: string
          from_project_id?: string
          id?: string
          input_id?: string
          notes?: string | null
          quantity?: number
          source_movement_id?: string | null
          status?: string
          to_location_id?: string
          to_project_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "procurement_cross_project_transfer_destination_movement_id_fkey"
            columns: ["destination_movement_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_from_balance_id_fkey"
            columns: ["from_balance_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_from_project_id_fkey"
            columns: ["from_project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_from_project_id_fkey"
            columns: ["from_project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_from_project_id_fkey"
            columns: ["from_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_source_movement_id_fkey"
            columns: ["source_movement_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_to_project_id_fkey"
            columns: ["to_project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_to_project_id_fkey"
            columns: ["to_project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_cross_project_transfers_to_project_id_fkey"
            columns: ["to_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          entity_id: string
          entity_type: string
          id: string
          project_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          entity_id: string
          entity_type: string
          id?: string
          project_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_balances: {
        Row: {
          available_quantity: number | null
          average_unit_cost: number
          batch_number: string
          category_snapshot: string | null
          company_id: string
          created_at: string
          expiration_date: string
          id: string
          input_code: string
          input_id: string
          input_name: string
          last_movement_at: string | null
          location_id: string
          maximum_quantity: number | null
          minimum_quantity: number
          project_id: string
          quantity_on_hand: number
          reserved_quantity: number
          total_value: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          available_quantity?: number | null
          average_unit_cost?: number
          batch_number?: string
          category_snapshot?: string | null
          company_id: string
          created_at?: string
          expiration_date?: string
          id?: string
          input_code: string
          input_id: string
          input_name: string
          last_movement_at?: string | null
          location_id: string
          maximum_quantity?: number | null
          minimum_quantity?: number
          project_id: string
          quantity_on_hand?: number
          reserved_quantity?: number
          total_value?: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          available_quantity?: number | null
          average_unit_cost?: number
          batch_number?: string
          category_snapshot?: string | null
          company_id?: string
          created_at?: string
          expiration_date?: string
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          last_movement_at?: string | null
          location_id?: string
          maximum_quantity?: number | null
          minimum_quantity?: number
          project_id?: string
          quantity_on_hand?: number
          reserved_quantity?: number
          total_value?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_balances_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_balances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_balances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_balances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_count_items: {
        Row: {
          balance_id: string | null
          batch_number: string
          book_quantity: number
          company_id: string
          count_id: string
          counted_quantity: number
          created_at: string
          difference_quantity: number | null
          difference_value: number
          expiration_date: string
          id: string
          input_code: string
          input_id: string
          input_name: string
          location_id: string
          notes: string | null
          project_id: string
          sort_order: number
          unit_cost: number
          unit_snapshot: string
        }
        Insert: {
          balance_id?: string | null
          batch_number?: string
          book_quantity: number
          company_id: string
          count_id: string
          counted_quantity: number
          created_at?: string
          difference_quantity?: number | null
          difference_value?: number
          expiration_date?: string
          id?: string
          input_code: string
          input_id: string
          input_name: string
          location_id: string
          notes?: string | null
          project_id: string
          sort_order?: number
          unit_cost?: number
          unit_snapshot: string
        }
        Update: {
          balance_id?: string | null
          batch_number?: string
          book_quantity?: number
          company_id?: string
          count_id?: string
          counted_quantity?: number
          created_at?: string
          difference_quantity?: number | null
          difference_value?: number
          expiration_date?: string
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          location_id?: string
          notes?: string | null
          project_id?: string
          sort_order?: number
          unit_cost?: number
          unit_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_count_items_balance_id_fkey"
            columns: ["balance_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_count_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_counts: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          count_date: string
          count_number: string
          counter_name: string | null
          counter_user_id: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          notes: string | null
          project_id: string
          sequence_no: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          count_date: string
          count_number: string
          counter_name?: string | null
          counter_user_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          notes?: string | null
          project_id: string
          sequence_no: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          count_date?: string
          count_number?: string
          counter_name?: string | null
          counter_user_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          project_id?: string
          sequence_no?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_counts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_counts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_counts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_counts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_locations: {
        Row: {
          address: string | null
          allow_negative: boolean
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          location_type: string
          name: string
          notes: string | null
          project_id: string
          responsible_name: string | null
          responsible_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          allow_negative?: boolean
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_type?: string
          name: string
          notes?: string | null
          project_id: string
          responsible_name?: string | null
          responsible_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          allow_negative?: boolean
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_type?: string
          name?: string
          notes?: string | null
          project_id?: string
          responsible_name?: string | null
          responsible_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_movements: {
        Row: {
          batch_number: string
          company_id: string
          cost_center_code: string | null
          cost_center_name: string | null
          cost_center_service_id: string | null
          created_at: string
          created_by: string | null
          expiration_date: string
          from_location_id: string | null
          id: string
          input_code: string
          input_id: string
          input_name: string
          movement_date: string
          movement_number: string
          movement_type: string
          notes: string | null
          project_id: string
          quantity: number
          recipient_name: string | null
          responsible_name: string | null
          reversed_by_movement_id: string | null
          sequence_no: number
          source_id: string | null
          source_reference: string | null
          source_type: string | null
          to_location_id: string | null
          total_value: number
          unit_cost: number
          unit_snapshot: string
        }
        Insert: {
          batch_number?: string
          company_id: string
          cost_center_code?: string | null
          cost_center_name?: string | null
          cost_center_service_id?: string | null
          created_at?: string
          created_by?: string | null
          expiration_date?: string
          from_location_id?: string | null
          id?: string
          input_code: string
          input_id: string
          input_name: string
          movement_date?: string
          movement_number: string
          movement_type: string
          notes?: string | null
          project_id: string
          quantity: number
          recipient_name?: string | null
          responsible_name?: string | null
          reversed_by_movement_id?: string | null
          sequence_no: number
          source_id?: string | null
          source_reference?: string | null
          source_type?: string | null
          to_location_id?: string | null
          total_value?: number
          unit_cost?: number
          unit_snapshot: string
        }
        Update: {
          batch_number?: string
          company_id?: string
          cost_center_code?: string | null
          cost_center_name?: string | null
          cost_center_service_id?: string | null
          created_at?: string
          created_by?: string | null
          expiration_date?: string
          from_location_id?: string | null
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          movement_date?: string
          movement_number?: string
          movement_type?: string
          notes?: string | null
          project_id?: string
          quantity?: number
          recipient_name?: string | null
          responsible_name?: string | null
          reversed_by_movement_id?: string | null
          sequence_no?: number
          source_id?: string | null
          source_reference?: string | null
          source_type?: string | null
          to_location_id?: string | null
          total_value?: number
          unit_cost?: number
          unit_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_cost_center_service_id_fkey"
            columns: ["cost_center_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_reversed_by_movement_id_fkey"
            columns: ["reversed_by_movement_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_inventory_reservations: {
        Row: {
          balance_id: string
          company_id: string
          consumed_movement_id: string | null
          created_at: string
          created_by: string | null
          id: string
          input_id: string
          location_id: string
          notes: string | null
          project_id: string
          quantity: number
          released_at: string | null
          released_by: string | null
          required_date: string | null
          service_id: string | null
          status: string
          supply_plan_item_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          balance_id: string
          company_id: string
          consumed_movement_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          input_id: string
          location_id: string
          notes?: string | null
          project_id: string
          quantity: number
          released_at?: string | null
          released_by?: string | null
          required_date?: string | null
          service_id?: string | null
          status?: string
          supply_plan_item_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          balance_id?: string
          company_id?: string
          consumed_movement_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          input_id?: string
          location_id?: string
          notes?: string | null
          project_id?: string
          quantity?: number
          released_at?: string | null
          released_by?: string | null
          required_date?: string | null
          service_id?: string | null
          status?: string
          supply_plan_item_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_inventory_reservations_balance_id_fkey"
            columns: ["balance_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_consumed_movement_id_fkey"
            columns: ["consumed_movement_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "procurement_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_supply_plan_item_id_fkey"
            columns: ["supply_plan_item_id"]
            isOneToOne: false
            referencedRelation: "engineering_supply_plan_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_inventory_reservations_supply_plan_item_id_fkey"
            columns: ["supply_plan_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_integrated_supply_control"
            referencedColumns: ["supply_plan_item_id"]
          },
        ]
      }
      procurement_material_quotation_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          quotation_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          quotation_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          quotation_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_audit_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_awards: {
        Row: {
          approved_at: string
          approved_by: string
          awarded_quantity: number
          awarded_total_cost: number
          awarded_unit_cost: number
          company_id: string
          created_at: string
          id: string
          justification: string | null
          offer_id: string
          offer_item_id: string
          project_id: string
          quotation_id: string
          quotation_item_id: string
          supplier_id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          awarded_quantity: number
          awarded_total_cost: number
          awarded_unit_cost: number
          company_id: string
          created_at?: string
          id?: string
          justification?: string | null
          offer_id: string
          offer_item_id: string
          project_id: string
          quotation_id: string
          quotation_item_id: string
          supplier_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          awarded_quantity?: number
          awarded_total_cost?: number
          awarded_unit_cost?: number
          company_id?: string
          created_at?: string
          id?: string
          justification?: string | null
          offer_id?: string
          offer_item_id?: string
          project_id?: string
          quotation_id?: string
          quotation_item_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_awards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_offer_item_id_fkey"
            columns: ["offer_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_offer_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_quotation_item_id_fkey"
            columns: ["quotation_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_awards_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          project_id: string
          quotation_id: string
          storage_path: string
          supplier_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          quotation_id: string
          storage_path: string
          supplier_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          quotation_id?: string
          storage_path?: string
          supplier_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_items: {
        Row: {
          awarded_offer_item_id: string | null
          awarded_quantity: number
          awarded_supplier_id: string | null
          awarded_total_cost: number
          awarded_unit_cost: number | null
          best_delivered_unit_cost: number | null
          best_total_cost: number | null
          category_snapshot: string
          company_id: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id: string | null
          created_at: string
          id: string
          input_code: string
          input_id: string
          input_name: string
          notes: string | null
          previously_ordered_quantity: number
          project_id: string
          quantity_to_quote: number
          quotation_id: string
          request_id: string
          request_item_id: string
          request_number: string
          requested_quantity: number
          sort_order: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          awarded_offer_item_id?: string | null
          awarded_quantity?: number
          awarded_supplier_id?: string | null
          awarded_total_cost?: number
          awarded_unit_cost?: number | null
          best_delivered_unit_cost?: number | null
          best_total_cost?: number | null
          category_snapshot: string
          company_id: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id?: string | null
          created_at?: string
          id?: string
          input_code: string
          input_id: string
          input_name: string
          notes?: string | null
          previously_ordered_quantity?: number
          project_id: string
          quantity_to_quote: number
          quotation_id: string
          request_id: string
          request_item_id: string
          request_number: string
          requested_quantity: number
          sort_order?: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          awarded_offer_item_id?: string | null
          awarded_quantity?: number
          awarded_supplier_id?: string | null
          awarded_total_cost?: number
          awarded_unit_cost?: number | null
          best_delivered_unit_cost?: number | null
          best_total_cost?: number | null
          category_snapshot?: string
          company_id?: string
          cost_center_code?: string
          cost_center_name?: string
          cost_center_service_id?: string | null
          created_at?: string
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          notes?: string | null
          previously_ordered_quantity?: number
          project_id?: string
          quantity_to_quote?: number
          quotation_id?: string
          request_id?: string
          request_item_id?: string
          request_number?: string
          requested_quantity?: number
          sort_order?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_item_cost_center_service_id_fkey"
            columns: ["cost_center_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_awarded_offer_item_fk"
            columns: ["awarded_offer_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_offer_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_awarded_supplier_id_fkey"
            columns: ["awarded_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_awarded_supplier_id_fkey"
            columns: ["awarded_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_awarded_supplier_id_fkey"
            columns: ["awarded_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "execution_material_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_items_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: false
            referencedRelation: "execution_material_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_offer_items: {
        Row: {
          brand: string | null
          company_id: string
          created_at: string
          delivered_unit_cost: number
          delivery_days: number | null
          discount_percent: number
          freight_amount: number
          id: string
          is_selected: boolean
          manufacturer: string | null
          meets_specification: boolean
          offer_id: string
          other_cost_amount: number
          project_id: string
          quantity_offered: number
          quotation_id: string
          quotation_item_id: string
          supplier_id: string
          tax_percent: number
          technical_notes: string | null
          total_delivered_cost: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          brand?: string | null
          company_id: string
          created_at?: string
          delivered_unit_cost: number
          delivery_days?: number | null
          discount_percent?: number
          freight_amount?: number
          id?: string
          is_selected?: boolean
          manufacturer?: string | null
          meets_specification?: boolean
          offer_id: string
          other_cost_amount?: number
          project_id: string
          quantity_offered: number
          quotation_id: string
          quotation_item_id: string
          supplier_id: string
          tax_percent?: number
          technical_notes?: string | null
          total_delivered_cost: number
          unit_price: number
          updated_at?: string
        }
        Update: {
          brand?: string | null
          company_id?: string
          created_at?: string
          delivered_unit_cost?: number
          delivery_days?: number | null
          discount_percent?: number
          freight_amount?: number
          id?: string
          is_selected?: boolean
          manufacturer?: string | null
          meets_specification?: boolean
          offer_id?: string
          other_cost_amount?: number
          project_id?: string
          quantity_offered?: number
          quotation_id?: string
          quotation_item_id?: string
          supplier_id?: string
          tax_percent?: number
          technical_notes?: string | null
          total_delivered_cost?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_offer_ite_quotation_item_id_fkey"
            columns: ["quotation_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offer_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_offers: {
        Row: {
          company_id: string
          delivery_days: number | null
          freight_terms: string | null
          id: string
          notes: string | null
          payment_terms: string | null
          project_id: string
          proposal_date: string | null
          proposal_number: string | null
          quotation_id: string
          quotation_supplier_id: string
          received_at: string
          received_by: string | null
          status: string
          supplier_id: string
          total_delivered_cost: number
          updated_at: string
          updated_by: string | null
          validity_date: string | null
          warranty_terms: string | null
        }
        Insert: {
          company_id: string
          delivery_days?: number | null
          freight_terms?: string | null
          id?: string
          notes?: string | null
          payment_terms?: string | null
          project_id: string
          proposal_date?: string | null
          proposal_number?: string | null
          quotation_id: string
          quotation_supplier_id: string
          received_at?: string
          received_by?: string | null
          status?: string
          supplier_id: string
          total_delivered_cost?: number
          updated_at?: string
          updated_by?: string | null
          validity_date?: string | null
          warranty_terms?: string | null
        }
        Update: {
          company_id?: string
          delivery_days?: number | null
          freight_terms?: string | null
          id?: string
          notes?: string | null
          payment_terms?: string | null
          project_id?: string
          proposal_date?: string | null
          proposal_number?: string | null
          quotation_id?: string
          quotation_supplier_id?: string
          received_at?: string
          received_by?: string | null
          status?: string
          supplier_id?: string
          total_delivered_cost?: number
          updated_at?: string
          updated_by?: string | null
          validity_date?: string | null
          warranty_terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_offer_quotation_supplier_id_fkey"
            columns: ["quotation_supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_offers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_requests: {
        Row: {
          company_id: string
          created_at: string
          id: string
          needed_date: string
          project_id: string
          quotation_id: string
          request_id: string
          request_number: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          needed_date: string
          project_id: string
          quotation_id: string
          request_id: string
          request_number: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          needed_date?: string
          project_id?: string
          quotation_id?: string
          request_id?: string
          request_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_requests_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_requests_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "execution_material_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotation_suppliers: {
        Row: {
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          quotation_id: string
          responded_at: string | null
          sent_at: string | null
          status: string
          supplier_id: string
          supplier_name: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          quotation_id: string
          responded_at?: string | null
          sent_at?: string | null
          status?: string
          supplier_id: string
          supplier_name: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          quotation_id?: string
          responded_at?: string | null
          sent_at?: string | null
          status?: string
          supplier_id?: string
          supplier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotation_suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_quotation_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_quotations: {
        Row: {
          analysis_started_at: string | null
          analysis_started_by: string | null
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          award_mode: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string
          delivery_address: string | null
          desired_delivery_date: string | null
          id: string
          invited_suppliers_count: number
          notes: string | null
          opened_at: string | null
          opened_by: string | null
          payment_terms: string | null
          project_id: string
          quotation_number: string
          response_deadline: string
          responses_count: number
          sequence_no: number
          status: string
          title: string
          total_awarded_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          analysis_started_at?: string | null
          analysis_started_by?: string | null
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          award_mode?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by: string
          delivery_address?: string | null
          desired_delivery_date?: string | null
          id?: string
          invited_suppliers_count?: number
          notes?: string | null
          opened_at?: string | null
          opened_by?: string | null
          payment_terms?: string | null
          project_id: string
          quotation_number: string
          response_deadline: string
          responses_count?: number
          sequence_no: number
          status?: string
          title: string
          total_awarded_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          analysis_started_at?: string | null
          analysis_started_by?: string | null
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          award_mode?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          delivery_address?: string | null
          desired_delivery_date?: string | null
          id?: string
          invited_suppliers_count?: number
          notes?: string | null
          opened_at?: string | null
          opened_by?: string | null
          payment_terms?: string | null
          project_id?: string
          quotation_number?: string
          response_deadline?: string
          responses_count?: number
          sequence_no?: number
          status?: string
          title?: string
          total_awarded_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_quotations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_quotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_quotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_receipt_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          new_status: string | null
          previous_status: string | null
          project_id: string
          reason: string | null
          receipt_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id: string
          reason?: string | null
          receipt_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_id?: string
          reason?: string | null
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_receipt_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_audit_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_receipt_discrepancies: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          discrepancy_type: string
          due_date: string | null
          id: string
          project_id: string
          receipt_id: string
          receipt_item_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          supplier_response: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          discrepancy_type: string
          due_date?: string | null
          id?: string
          project_id: string
          receipt_id: string
          receipt_item_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          supplier_response?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discrepancy_type?: string
          due_date?: string | null
          id?: string
          project_id?: string
          receipt_id?: string
          receipt_item_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          supplier_response?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_receipt_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_discrepancies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_discrepancies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_discrepancies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_discrepancies_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_discrepancies_receipt_item_id_fkey"
            columns: ["receipt_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipt_items"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_receipt_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          project_id: string
          receipt_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          receipt_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          receipt_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_receipt_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_documents_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_receipt_items: {
        Row: {
          accepted_amount: number
          accepted_quantity: number
          batch_number: string | null
          company_id: string
          condition: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id: string | null
          created_at: string
          delivered_quantity: number
          destination_location: string | null
          expiration_date: string | null
          id: string
          input_code: string
          input_id: string
          input_name: string
          notes: string | null
          order_id: string
          order_item_id: string
          ordered_quantity: number
          previously_accepted_quantity: number
          project_id: string
          receipt_id: string
          rejected_quantity: number
          rejection_reason: string | null
          sort_order: number
          unit_cost: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          accepted_amount?: number
          accepted_quantity: number
          batch_number?: string | null
          company_id: string
          condition?: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id?: string | null
          created_at?: string
          delivered_quantity: number
          destination_location?: string | null
          expiration_date?: string | null
          id?: string
          input_code: string
          input_id: string
          input_name: string
          notes?: string | null
          order_id: string
          order_item_id: string
          ordered_quantity: number
          previously_accepted_quantity?: number
          project_id: string
          receipt_id: string
          rejected_quantity?: number
          rejection_reason?: string | null
          sort_order?: number
          unit_cost: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          accepted_amount?: number
          accepted_quantity?: number
          batch_number?: string | null
          company_id?: string
          condition?: string
          cost_center_code?: string
          cost_center_name?: string
          cost_center_service_id?: string | null
          created_at?: string
          delivered_quantity?: number
          destination_location?: string | null
          expiration_date?: string | null
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          notes?: string | null
          order_id?: string
          order_item_id?: string
          ordered_quantity?: number
          previously_accepted_quantity?: number
          project_id?: string
          receipt_id?: string
          rejected_quantity?: number
          rejection_reason?: string | null
          sort_order?: number
          unit_cost?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_receipt_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_cost_center_service_id_fkey"
            columns: ["cost_center_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_material_receipts: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          arrival_time: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          carrier_name: string | null
          company_id: string
          created_at: string
          created_by: string
          delivery_document: string | null
          driver_name: string | null
          general_condition: string | null
          id: string
          invoice_access_key: string | null
          invoice_amount: number | null
          invoice_date: string | null
          invoice_number: string | null
          invoice_series: string | null
          notes: string | null
          order_id: string
          project_id: string
          receipt_date: string
          receipt_number: string
          receiver_name: string | null
          receiver_user_id: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          sequence_no: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          supplier_id: string
          updated_at: string
          updated_by: string | null
          vehicle_plate: string | null
          warehouse_location: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          arrival_time?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          carrier_name?: string | null
          company_id: string
          created_at?: string
          created_by: string
          delivery_document?: string | null
          driver_name?: string | null
          general_condition?: string | null
          id?: string
          invoice_access_key?: string | null
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_series?: string | null
          notes?: string | null
          order_id: string
          project_id: string
          receipt_date: string
          receipt_number: string
          receiver_name?: string | null
          receiver_user_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sequence_no: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_plate?: string | null
          warehouse_location?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          arrival_time?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          carrier_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          delivery_document?: string | null
          driver_name?: string | null
          general_condition?: string | null
          id?: string
          invoice_access_key?: string | null
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_series?: string | null
          notes?: string | null
          order_id?: string
          project_id?: string
          receipt_date?: string
          receipt_number?: string
          receiver_name?: string | null
          receiver_user_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sequence_no?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          supplier_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_plate?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_material_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_material_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_purchase_order_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          new_status: string | null
          order_id: string
          previous_status: string | null
          project_id: string
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          new_status?: string | null
          order_id: string
          previous_status?: string | null
          project_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          new_status?: string | null
          order_id?: string
          previous_status?: string | null
          project_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_purchase_order_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_purchase_order_documents: {
        Row: {
          caption: string | null
          company_id: string
          document_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          order_id: string
          project_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          document_type?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          order_id: string
          project_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          document_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          order_id?: string
          project_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_purchase_order_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_purchase_order_items: {
        Row: {
          accepted_quantity: number
          award_id: string | null
          brand: string | null
          cancelled_quantity: number
          company_id: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id: string | null
          created_at: string
          delivered_unit_cost: number
          discount_percent: number
          expected_delivery_date: string | null
          freight_amount: number
          id: string
          input_code: string
          input_id: string
          input_name: string
          manufacturer: string | null
          notes: string | null
          offer_item_id: string | null
          order_id: string
          ordered_quantity: number
          other_cost_amount: number
          project_id: string
          quotation_id: string | null
          quotation_item_id: string | null
          received_quantity: number
          rejected_quantity: number
          request_id: string | null
          request_item_id: string | null
          request_number: string
          sort_order: number
          source_id: string | null
          source_system: string | null
          tax_percent: number
          total_amount: number
          unit_price: number
          unit_snapshot: string
          updated_at: string
        }
        Insert: {
          accepted_quantity?: number
          award_id?: string | null
          brand?: string | null
          cancelled_quantity?: number
          company_id: string
          cost_center_code: string
          cost_center_name: string
          cost_center_service_id?: string | null
          created_at?: string
          delivered_unit_cost: number
          discount_percent?: number
          expected_delivery_date?: string | null
          freight_amount?: number
          id?: string
          input_code: string
          input_id: string
          input_name: string
          manufacturer?: string | null
          notes?: string | null
          offer_item_id?: string | null
          order_id: string
          ordered_quantity: number
          other_cost_amount?: number
          project_id: string
          quotation_id?: string | null
          quotation_item_id?: string | null
          received_quantity?: number
          rejected_quantity?: number
          request_id?: string | null
          request_item_id?: string | null
          request_number: string
          sort_order?: number
          source_id?: string | null
          source_system?: string | null
          tax_percent?: number
          total_amount: number
          unit_price: number
          unit_snapshot: string
          updated_at?: string
        }
        Update: {
          accepted_quantity?: number
          award_id?: string | null
          brand?: string | null
          cancelled_quantity?: number
          company_id?: string
          cost_center_code?: string
          cost_center_name?: string
          cost_center_service_id?: string | null
          created_at?: string
          delivered_unit_cost?: number
          discount_percent?: number
          expected_delivery_date?: string | null
          freight_amount?: number
          id?: string
          input_code?: string
          input_id?: string
          input_name?: string
          manufacturer?: string | null
          notes?: string | null
          offer_item_id?: string | null
          order_id?: string
          ordered_quantity?: number
          other_cost_amount?: number
          project_id?: string
          quotation_id?: string | null
          quotation_item_id?: string | null
          received_quantity?: number
          rejected_quantity?: number
          request_id?: string | null
          request_item_id?: string | null
          request_number?: string
          sort_order?: number
          source_id?: string | null
          source_system?: string | null
          tax_percent?: number
          total_amount?: number
          unit_price?: number
          unit_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_purchase_order_items_award_id_fkey"
            columns: ["award_id"]
            isOneToOne: true
            referencedRelation: "procurement_material_quotation_awards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_cost_center_service_id_fkey"
            columns: ["cost_center_service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_offer_item_id_fkey"
            columns: ["offer_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_offer_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "procurement_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_quotation_item_id_fkey"
            columns: ["quotation_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "execution_material_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_order_items_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: false
            referencedRelation: "execution_material_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_purchase_orders: {
        Row: {
          buyer_name: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          delivery_address: string | null
          discount_amount: number
          expected_delivery_date: string | null
          freight_amount: number
          freight_terms: string | null
          id: string
          invoiced_amount: number
          issue_date: string | null
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          order_number: string
          other_cost_amount: number
          payment_terms: string | null
          project_id: string
          quotation_id: string | null
          received_amount: number
          sequence_no: number
          source_id: string | null
          source_system: string | null
          status: string
          subtotal_amount: number
          supplier_confirmation_reference: string | null
          supplier_contact_email: string | null
          supplier_contact_name: string | null
          supplier_contact_phone: string | null
          supplier_id: string
          supplier_notes: string | null
          tax_amount: number
          total_amount: number
          updated_at: string
          updated_by: string | null
          warranty_terms: string | null
        }
        Insert: {
          buyer_name?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by: string
          delivery_address?: string | null
          discount_amount?: number
          expected_delivery_date?: string | null
          freight_amount?: number
          freight_terms?: string | null
          id?: string
          invoiced_amount?: number
          issue_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          order_number: string
          other_cost_amount?: number
          payment_terms?: string | null
          project_id: string
          quotation_id?: string | null
          received_amount?: number
          sequence_no: number
          source_id?: string | null
          source_system?: string | null
          status?: string
          subtotal_amount?: number
          supplier_confirmation_reference?: string | null
          supplier_contact_email?: string | null
          supplier_contact_name?: string | null
          supplier_contact_phone?: string | null
          supplier_id: string
          supplier_notes?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          warranty_terms?: string | null
        }
        Update: {
          buyer_name?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string
          delivery_address?: string | null
          discount_amount?: number
          expected_delivery_date?: string | null
          freight_amount?: number
          freight_terms?: string | null
          id?: string
          invoiced_amount?: number
          issue_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          order_number?: string
          other_cost_amount?: number
          payment_terms?: string | null
          project_id?: string
          quotation_id?: string | null
          received_amount?: number
          sequence_no?: number
          source_id?: string | null
          source_system?: string | null
          status?: string
          subtotal_amount?: number
          supplier_confirmation_reference?: string | null
          supplier_contact_email?: string | null
          supplier_contact_name?: string | null
          supplier_contact_phone?: string | null
          supplier_id?: string
          supplier_notes?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          warranty_terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_material_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "procurement_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_memberships: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address_number: string | null
          built_area_m2: number
          city: string | null
          code: string | null
          common_area_m2: number
          company_id: string
          complement: string | null
          construction_start_date: string | null
          cover_image_path: string | null
          created_at: string
          created_by: string
          delivery_date: string | null
          description: string | null
          district: string | null
          forecast_default_payment_days: number
          id: string
          land_area_m2: number
          launch_date: string | null
          legal_entity_id: string | null
          name: string
          notes: string | null
          parking_spaces: number
          postal_code: string | null
          private_area_m2: number
          project_type: string
          registration_number: string | null
          state: string | null
          status: string
          street: string | null
          total_floors: number
          total_towers: number
          total_units: number
          updated_at: string
        }
        Insert: {
          address_number?: string | null
          built_area_m2?: number
          city?: string | null
          code?: string | null
          common_area_m2?: number
          company_id: string
          complement?: string | null
          construction_start_date?: string | null
          cover_image_path?: string | null
          created_at?: string
          created_by: string
          delivery_date?: string | null
          description?: string | null
          district?: string | null
          forecast_default_payment_days?: number
          id?: string
          land_area_m2?: number
          launch_date?: string | null
          legal_entity_id?: string | null
          name: string
          notes?: string | null
          parking_spaces?: number
          postal_code?: string | null
          private_area_m2?: number
          project_type?: string
          registration_number?: string | null
          state?: string | null
          status?: string
          street?: string | null
          total_floors?: number
          total_towers?: number
          total_units?: number
          updated_at?: string
        }
        Update: {
          address_number?: string | null
          built_area_m2?: number
          city?: string | null
          code?: string | null
          common_area_m2?: number
          company_id?: string
          complement?: string | null
          construction_start_date?: string | null
          cover_image_path?: string | null
          created_at?: string
          created_by?: string
          delivery_date?: string | null
          description?: string | null
          district?: string | null
          forecast_default_payment_days?: number
          id?: string
          land_area_m2?: number
          launch_date?: string | null
          legal_entity_id?: string | null
          name?: string
          notes?: string | null
          parking_spaces?: number
          postal_code?: string | null
          private_area_m2?: number
          project_type?: string
          registration_number?: string | null
          state?: string | null
          status?: string
          street?: string | null
          total_floors?: number
          total_towers?: number
          total_units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_legal_entity_fk"
            columns: ["company_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      quality_attachments: {
        Row: {
          attachment_type: string
          caption: string | null
          company_id: string
          file_name: string
          file_size: number | null
          id: string
          inspection_id: string | null
          inspection_item_id: string | null
          mime_type: string | null
          nonconformity_id: string | null
          project_id: string
          reinspection_id: string | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          attachment_type?: string
          caption?: string | null
          company_id: string
          file_name: string
          file_size?: number | null
          id?: string
          inspection_id?: string | null
          inspection_item_id?: string | null
          mime_type?: string | null
          nonconformity_id?: string | null
          project_id: string
          reinspection_id?: string | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          attachment_type?: string
          caption?: string | null
          company_id?: string
          file_name?: string
          file_size?: number | null
          id?: string
          inspection_id?: string | null
          inspection_item_id?: string | null
          mime_type?: string | null
          nonconformity_id?: string | null
          project_id?: string
          reinspection_id?: string | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_attachments_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_attachments_inspection_item_id_fkey"
            columns: ["inspection_item_id"]
            isOneToOne: false
            referencedRelation: "quality_inspection_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_attachments_nonconformity_id_fkey"
            columns: ["nonconformity_id"]
            isOneToOne: false
            referencedRelation: "quality_nonconformities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_attachments_reinspection_id_fkey"
            columns: ["reinspection_id"]
            isOneToOne: false
            referencedRelation: "quality_reinspections"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_audit_logs: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          checklist_version_id: string | null
          company_id: string
          entity_id: string
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
          project_id: string | null
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          checklist_version_id?: string | null
          company_id: string
          entity_id: string
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          project_id?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          checklist_version_id?: string | null
          company_id?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          project_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_audit_logs_checklist_version_id_fkey"
            columns: ["checklist_version_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_checklist_criteria: {
        Row: {
          acceptance_criterion: string | null
          allow_reservation: boolean
          code: string
          company_id: string
          created_at: string
          description: string
          failure_severity: string
          group_name: string
          guidance: string | null
          id: string
          is_blocking: boolean
          is_required: boolean
          measurement_unit: string | null
          requires_measurement: boolean
          requires_photo: boolean
          sort_order: number
          verification_method: string | null
          verification_moment: string | null
          version_id: string
          weight: number
        }
        Insert: {
          acceptance_criterion?: string | null
          allow_reservation?: boolean
          code: string
          company_id: string
          created_at?: string
          description: string
          failure_severity?: string
          group_name?: string
          guidance?: string | null
          id?: string
          is_blocking?: boolean
          is_required?: boolean
          measurement_unit?: string | null
          requires_measurement?: boolean
          requires_photo?: boolean
          sort_order?: number
          verification_method?: string | null
          verification_moment?: string | null
          version_id: string
          weight?: number
        }
        Update: {
          acceptance_criterion?: string | null
          allow_reservation?: boolean
          code?: string
          company_id?: string
          created_at?: string
          description?: string
          failure_severity?: string
          group_name?: string
          guidance?: string | null
          id?: string
          is_blocking?: boolean
          is_required?: boolean
          measurement_unit?: string | null
          requires_measurement?: boolean
          requires_photo?: boolean
          sort_order?: number
          verification_method?: string | null
          verification_moment?: string | null
          version_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "quality_checklist_criteria_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_checklist_criteria_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_checklist_templates: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          criticality: string
          current_version_id: string | null
          description: string | null
          evidence_rule: string | null
          has_blocking_gate: boolean
          id: string
          inspection_unit: string
          name: string
          periodicity: string
          sampling_rule: string | null
          service_id: string | null
          service_weight: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          criticality?: string
          current_version_id?: string | null
          description?: string | null
          evidence_rule?: string | null
          has_blocking_gate?: boolean
          id?: string
          inspection_unit?: string
          name: string
          periodicity?: string
          sampling_rule?: string | null
          service_id?: string | null
          service_weight?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          criticality?: string
          current_version_id?: string | null
          description?: string | null
          evidence_rule?: string | null
          has_blocking_gate?: boolean
          id?: string
          inspection_unit?: string
          name?: string
          periodicity?: string
          sampling_rule?: string | null
          service_id?: string | null
          service_weight?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_checklist_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_checklist_templates_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_templates_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_checklist_versions: {
        Row: {
          change_notes: string | null
          company_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          published_at: string | null
          published_by: string | null
          status: string
          template_id: string
          version_no: number
        }
        Insert: {
          change_notes?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          template_id: string
          version_no: number
        }
        Update: {
          change_notes?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          template_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "quality_checklist_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_checklist_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspection_items: {
        Row: {
          acceptance_criterion_snapshot: string | null
          allow_reservation_snapshot: boolean
          answered_at: string | null
          answered_by: string | null
          code_snapshot: string
          company_id: string
          created_at: string
          criterion_id: string
          description_snapshot: string
          failure_severity_snapshot: string
          group_name_snapshot: string
          guidance_snapshot: string | null
          id: string
          inspection_id: string
          is_blocking_snapshot: boolean
          is_required_snapshot: boolean
          measurement_unit_snapshot: string | null
          measurement_value: number | null
          observation: string | null
          project_id: string
          requires_measurement_snapshot: boolean
          requires_photo_snapshot: boolean
          response: string | null
          sort_order: number
          updated_at: string
          verification_method_snapshot: string | null
          weight_snapshot: number
        }
        Insert: {
          acceptance_criterion_snapshot?: string | null
          allow_reservation_snapshot: boolean
          answered_at?: string | null
          answered_by?: string | null
          code_snapshot: string
          company_id: string
          created_at?: string
          criterion_id: string
          description_snapshot: string
          failure_severity_snapshot: string
          group_name_snapshot: string
          guidance_snapshot?: string | null
          id?: string
          inspection_id: string
          is_blocking_snapshot: boolean
          is_required_snapshot: boolean
          measurement_unit_snapshot?: string | null
          measurement_value?: number | null
          observation?: string | null
          project_id: string
          requires_measurement_snapshot: boolean
          requires_photo_snapshot: boolean
          response?: string | null
          sort_order?: number
          updated_at?: string
          verification_method_snapshot?: string | null
          weight_snapshot: number
        }
        Update: {
          acceptance_criterion_snapshot?: string | null
          allow_reservation_snapshot?: boolean
          answered_at?: string | null
          answered_by?: string | null
          code_snapshot?: string
          company_id?: string
          created_at?: string
          criterion_id?: string
          description_snapshot?: string
          failure_severity_snapshot?: string
          group_name_snapshot?: string
          guidance_snapshot?: string | null
          id?: string
          inspection_id?: string
          is_blocking_snapshot?: boolean
          is_required_snapshot?: boolean
          measurement_unit_snapshot?: string | null
          measurement_value?: number | null
          observation?: string | null
          project_id?: string
          requires_measurement_snapshot?: boolean
          requires_photo_snapshot?: boolean
          response?: string | null
          sort_order?: number
          updated_at?: string
          verification_method_snapshot?: string | null
          weight_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspection_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_items_criterion_id_fkey"
            columns: ["criterion_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_inspection_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_inspection_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspection_rules: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          due_offset_days: number
          event_type: string
          id: string
          location_scope: string
          only_first_location: boolean
          project_id: string | null
          service_id: string
          stage_name: string
          template_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          due_offset_days?: number
          event_type?: string
          id?: string
          location_scope?: string
          only_first_location?: boolean
          project_id?: string | null
          service_id: string
          stage_name: string
          template_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_offset_days?: number
          event_type?: string
          id?: string
          location_scope?: string
          only_first_location?: boolean
          project_id?: string | null
          service_id?: string
          stage_name?: string
          template_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspection_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_inspection_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_inspection_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspection_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspections: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checklist_version_id: string
          company_id: string
          completed_at: string | null
          completed_by: string | null
          completion_percent: number
          created_at: string
          created_by: string | null
          current_score: number | null
          due_date: string
          environment_name: string | null
          executor_confirmed: boolean
          executor_team: string | null
          first_inspection_score: number | null
          general_notes: string | null
          id: string
          inspection_number: string
          location_id: string | null
          origin: string
          project_id: string
          release_status: string
          responsible_engineer_user_id: string
          rule_id: string | null
          schedule_activity_id: string | null
          service_id: string
          stage_name: string
          started_at: string | null
          status: string
          supplier_id: string | null
          template_id: string
          tower: string | null
          unit_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checklist_version_id: string
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          completion_percent?: number
          created_at?: string
          created_by?: string | null
          current_score?: number | null
          due_date: string
          environment_name?: string | null
          executor_confirmed?: boolean
          executor_team?: string | null
          first_inspection_score?: number | null
          general_notes?: string | null
          id?: string
          inspection_number: string
          location_id?: string | null
          origin?: string
          project_id: string
          release_status?: string
          responsible_engineer_user_id: string
          rule_id?: string | null
          schedule_activity_id?: string | null
          service_id: string
          stage_name: string
          started_at?: string | null
          status?: string
          supplier_id?: string | null
          template_id: string
          tower?: string | null
          unit_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checklist_version_id?: string
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_percent?: number
          created_at?: string
          created_by?: string | null
          current_score?: number | null
          due_date?: string
          environment_name?: string | null
          executor_confirmed?: boolean
          executor_team?: string | null
          first_inspection_score?: number | null
          general_notes?: string | null
          id?: string
          inspection_number?: string
          location_id?: string | null
          origin?: string
          project_id?: string
          release_status?: string
          responsible_engineer_user_id?: string
          rule_id?: string | null
          schedule_activity_id?: string | null
          service_id?: string
          stage_name?: string
          started_at?: string | null
          status?: string
          supplier_id?: string | null
          template_id?: string
          tower?: string | null
          unit_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_checklist_version_id_fkey"
            columns: ["checklist_version_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "quality_inspection_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "quality_inspections_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "quality_inspections_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quality_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_nonconformities: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          correction_report: string | null
          correction_reported_at: string | null
          correction_reported_by: string | null
          corrective_action: string | null
          created_at: string
          created_by: string | null
          description: string
          due_at: string
          due_change_reason: string | null
          estimated_rework_cost: number
          id: string
          inspection_id: string
          inspection_item_id: string
          is_blocking: boolean
          location_id: string | null
          nc_number: string
          opened_at: string
          probable_cause: string | null
          project_id: string
          responsible_team: string | null
          responsible_user_id: string | null
          service_id: string
          severity: string
          status: string
          supplier_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          correction_report?: string | null
          correction_reported_at?: string | null
          correction_reported_by?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_at: string
          due_change_reason?: string | null
          estimated_rework_cost?: number
          id?: string
          inspection_id: string
          inspection_item_id: string
          is_blocking?: boolean
          location_id?: string | null
          nc_number: string
          opened_at?: string
          probable_cause?: string | null
          project_id: string
          responsible_team?: string | null
          responsible_user_id?: string | null
          service_id: string
          severity: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          correction_report?: string | null
          correction_reported_at?: string | null
          correction_reported_by?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_at?: string
          due_change_reason?: string | null
          estimated_rework_cost?: number
          id?: string
          inspection_id?: string
          inspection_item_id?: string
          is_blocking?: boolean
          location_id?: string | null
          nc_number?: string
          opened_at?: string
          probable_cause?: string | null
          project_id?: string
          responsible_team?: string | null
          responsible_user_id?: string | null
          service_id?: string
          severity?: string
          status?: string
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_nonconformities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_nonconformities_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_nonconformities_inspection_item_id_fkey"
            columns: ["inspection_item_id"]
            isOneToOne: true
            referencedRelation: "quality_inspection_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_nonconformities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_nonconformities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_nonconformities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_nonconformities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_nonconformities_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_nonconformities_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "quality_nonconformities_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "quality_nonconformities_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_notifications: {
        Row: {
          company_id: string
          created_at: string
          id: string
          inspection_id: string | null
          message: string
          nonconformity_id: string | null
          notification_type: string
          project_id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          inspection_id?: string | null
          message: string
          nonconformity_id?: string | null
          notification_type: string
          project_id: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          inspection_id?: string | null
          message?: string
          nonconformity_id?: string | null
          notification_type?: string
          project_id?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_notifications_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_notifications_nonconformity_id_fkey"
            columns: ["nonconformity_id"]
            isOneToOne: false
            referencedRelation: "quality_nonconformities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_reinspections: {
        Row: {
          company_id: string
          created_at: string
          id: string
          inspection_id: string
          nonconformity_id: string
          notes: string
          project_id: string
          reinspected_at: string
          reinspected_by: string
          result: string
          sequence_no: number
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          inspection_id: string
          nonconformity_id: string
          notes: string
          project_id: string
          reinspected_at?: string
          reinspected_by: string
          result: string
          sequence_no: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          inspection_id?: string
          nonconformity_id?: string
          notes?: string
          project_id?: string
          reinspected_at?: string
          reinspected_by?: string
          result?: string
          sequence_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "quality_reinspections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_reinspections_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_reinspections_nonconformity_id_fkey"
            columns: ["nonconformity_id"]
            isOneToOne: false
            referencedRelation: "quality_nonconformities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_reinspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_reinspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_reinspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_service_releases: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          inspection_id: string
          location_id: string | null
          project_id: string
          reason: string | null
          released_at: string | null
          released_by: string | null
          schedule_activity_id: string | null
          service_id: string
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_id: string
          location_id?: string | null
          project_id: string
          reason?: string | null
          released_at?: string | null
          released_by?: string | null
          schedule_activity_id?: string | null
          service_id: string
          status: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_id?: string
          location_id?: string | null
          project_id?: string
          reason?: string | null
          released_at?: string | null
          released_by?: string | null
          schedule_activity_id?: string | null
          service_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_service_releases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_service_releases_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_service_releases_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_service_releases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_service_releases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_service_releases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_service_releases_schedule_activity_id_fkey"
            columns: ["schedule_activity_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_service_releases_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "engineering_services"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_settings: {
        Row: {
          auto_sync: boolean
          company_id: string
          created_at: string
          created_by: string | null
          critical_due_hours: number
          first_inspection_weight: number
          id: string
          light_due_days: number
          non_recurrence_weight: number
          on_time_correction_weight: number
          project_id: string
          responsible_engineer_user_id: string | null
          serious_due_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_sync?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          critical_due_hours?: number
          first_inspection_weight?: number
          id?: string
          light_due_days?: number
          non_recurrence_weight?: number
          on_time_correction_weight?: number
          project_id: string
          responsible_engineer_user_id?: string | null
          serious_due_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_sync?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          critical_due_hours?: number
          first_inspection_weight?: number
          id?: string
          light_due_days?: number
          non_recurrence_weight?: number
          on_time_correction_weight?: number
          project_id?: string
          responsible_engineer_user_id?: string | null
          serious_due_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "quality_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables: {
        Row: {
          adjusted_amount: number
          adjustment_index: string | null
          amount: number
          bank_account_id: string | null
          bank_transaction_id: string | null
          category: string
          client_id: string
          company_id: string
          correction_amount: number
          correction_base_month: string | null
          correction_base_value: number | null
          correction_index_id: string | null
          correction_locked: boolean
          correction_reference_month: string | null
          correction_reference_value: number | null
          created_at: string
          created_by: string | null
          description: string
          discount_amount: number
          due_date: string
          id: string
          installment_interest_amount: number
          interest_rate_monthly: number | null
          late_fee_amount: number
          notes: string | null
          other_accrual_amount: number
          paid_account_name: string | null
          paid_amount: number | null
          paid_at: string | null
          project_id: string
          sale_id: string
          sequence_number: number
          sequence_total: number
          source_id: string | null
          source_page: number | null
          source_record_kind: string | null
          source_system: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          adjusted_amount?: number
          adjustment_index?: string | null
          amount: number
          bank_account_id?: string | null
          bank_transaction_id?: string | null
          category: string
          client_id: string
          company_id: string
          correction_amount?: number
          correction_base_month?: string | null
          correction_base_value?: number | null
          correction_index_id?: string | null
          correction_locked?: boolean
          correction_reference_month?: string | null
          correction_reference_value?: number | null
          created_at?: string
          created_by?: string | null
          description: string
          discount_amount?: number
          due_date: string
          id?: string
          installment_interest_amount?: number
          interest_rate_monthly?: number | null
          late_fee_amount?: number
          notes?: string | null
          other_accrual_amount?: number
          paid_account_name?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          project_id: string
          sale_id: string
          sequence_number?: number
          sequence_total?: number
          source_id?: string | null
          source_page?: number | null
          source_record_kind?: string | null
          source_system?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          adjusted_amount?: number
          adjustment_index?: string | null
          amount?: number
          bank_account_id?: string | null
          bank_transaction_id?: string | null
          category?: string
          client_id?: string
          company_id?: string
          correction_amount?: number
          correction_base_month?: string | null
          correction_base_value?: number | null
          correction_index_id?: string | null
          correction_locked?: boolean
          correction_reference_month?: string | null
          correction_reference_value?: number | null
          created_at?: string
          created_by?: string | null
          description?: string
          discount_amount?: number
          due_date?: string
          id?: string
          installment_interest_amount?: number
          interest_rate_monthly?: number | null
          late_fee_amount?: number
          notes?: string | null
          other_accrual_amount?: number
          paid_account_name?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          project_id?: string
          sale_id?: string
          sequence_number?: number
          sequence_total?: number
          source_id?: string | null
          source_page?: number | null
          source_record_kind?: string | null
          source_system?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivables_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_correction_index_id_fkey"
            columns: ["correction_index_id"]
            isOneToOne: false
            referencedRelation: "correction_indices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "receivables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "receivables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          permission_key: string
          role_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          permission_key: string
          role_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          broker_id: string | null
          broker_name: string | null
          client_id: string
          commission_amount: number
          commission_pct: number
          company_id: string
          contract_number: string | null
          correction_start_month: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          number: string
          payment_plan_available: boolean
          project_id: string
          sale_date: string
          source_code: string | null
          source_id: string | null
          source_system: string | null
          status: string
          total_amount: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          broker_id?: string | null
          broker_name?: string | null
          client_id: string
          commission_amount?: number
          commission_pct?: number
          company_id: string
          contract_number?: string | null
          correction_start_month?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          number: string
          payment_plan_available?: boolean
          project_id: string
          sale_date: string
          source_code?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          total_amount: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          broker_id?: string | null
          broker_name?: string | null
          client_id?: string
          commission_amount?: number
          commission_pct?: number
          company_id?: string
          contract_number?: string | null
          correction_start_month?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          number?: string
          payment_plan_available?: boolean
          project_id?: string
          sale_date?: string
          source_code?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          total_amount?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "commercial_brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          category: string | null
          city: string | null
          company_id: string
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          legal_name: string
          notes: string | null
          person_type: string
          phone: string | null
          source_id: string | null
          source_system: string | null
          state: string | null
          state_registration: string | null
          status: string
          tax_id: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          category?: string | null
          city?: string | null
          company_id: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          person_type?: string
          phone?: string | null
          source_id?: string | null
          source_system?: string | null
          state?: string | null
          state_registration?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          category?: string | null
          city?: string | null
          company_id?: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          person_type?: string
          phone?: string | null
          source_id?: string | null
          source_system?: string | null
          state?: string | null
          state_registration?: string | null
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_data_audit: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          details: Json
          export_id: string | null
          id: string
          project_id: string | null
          restore_request_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          details?: Json
          export_id?: string | null
          id?: string
          project_id?: string | null
          restore_request_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          details?: Json
          export_id?: string | null
          id?: string
          project_id?: string | null
          restore_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_data_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_data_audit_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "system_data_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_data_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "system_data_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "system_data_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_data_audit_restore_request_id_fkey"
            columns: ["restore_request_id"]
            isOneToOne: false
            referencedRelation: "system_data_restore_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      system_data_exports: {
        Row: {
          checksum_sha256: string | null
          company_id: string
          completed_at: string | null
          deleted_at: string | null
          download_count: number
          error_message: string | null
          expires_at: string
          file_name: string | null
          file_size: number | null
          format: string
          id: string
          last_downloaded_at: string | null
          metadata: Json
          mime_type: string | null
          modules: string[]
          project_id: string | null
          requested_at: string
          requested_by: string | null
          row_count: number
          scope_type: string
          status: string
          storage_path: string | null
          table_count: number
        }
        Insert: {
          checksum_sha256?: string | null
          company_id: string
          completed_at?: string | null
          deleted_at?: string | null
          download_count?: number
          error_message?: string | null
          expires_at?: string
          file_name?: string | null
          file_size?: number | null
          format?: string
          id?: string
          last_downloaded_at?: string | null
          metadata?: Json
          mime_type?: string | null
          modules?: string[]
          project_id?: string | null
          requested_at?: string
          requested_by?: string | null
          row_count?: number
          scope_type?: string
          status?: string
          storage_path?: string | null
          table_count?: number
        }
        Update: {
          checksum_sha256?: string | null
          company_id?: string
          completed_at?: string | null
          deleted_at?: string | null
          download_count?: number
          error_message?: string | null
          expires_at?: string
          file_name?: string | null
          file_size?: number | null
          format?: string
          id?: string
          last_downloaded_at?: string | null
          metadata?: Json
          mime_type?: string | null
          modules?: string[]
          project_id?: string | null
          requested_at?: string
          requested_by?: string | null
          row_count?: number
          scope_type?: string
          status?: string
          storage_path?: string | null
          table_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_data_exports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_data_exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "system_data_exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "system_data_exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      system_data_restore_requests: {
        Row: {
          company_id: string
          completed_at: string | null
          completion_notes: string | null
          export_id: string
          id: string
          metadata: Json
          project_id: string | null
          reason: string
          requested_at: string
          requested_by: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          completion_notes?: string | null
          export_id: string
          id?: string
          metadata?: Json
          project_id?: string | null
          reason: string
          requested_at?: string
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          completion_notes?: string | null
          export_id?: string
          id?: string
          metadata?: Json
          project_id?: string | null
          reason?: string
          requested_at?: string
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_data_restore_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_data_restore_requests_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "system_data_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_data_restore_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "system_data_restore_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "system_data_restore_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      system_role_permission_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          details: Json
          id: string
          new_permissions: string[]
          previous_permissions: string[]
          role_id: string | null
          role_key: string
          role_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          details?: Json
          id?: string
          new_permissions?: string[]
          previous_permissions?: string[]
          role_id?: string | null
          role_key: string
          role_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          details?: Json
          id?: string
          new_permissions?: string[]
          previous_permissions?: string[]
          role_id?: string | null
          role_key?: string
          role_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_role_permission_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_role_permission_audit_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          bedrooms: number | null
          code: string
          common_area: number | null
          company_id: string
          created_at: string
          created_by: string | null
          floor: number | null
          floor_location_id: string | null
          fractional_share: number | null
          id: string
          list_price: number | null
          notes: string | null
          parking_description: string | null
          parking_spaces: number | null
          position: string | null
          private_area: number | null
          project_id: string
          registry: string | null
          source_id: string | null
          source_system: string | null
          status: string
          suites: number | null
          total_area: number | null
          tower: string | null
          type: string | null
          uncovered_private_area: number | null
          updated_at: string
        }
        Insert: {
          bedrooms?: number | null
          code: string
          common_area?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          floor?: number | null
          floor_location_id?: string | null
          fractional_share?: number | null
          id?: string
          list_price?: number | null
          notes?: string | null
          parking_description?: string | null
          parking_spaces?: number | null
          position?: string | null
          private_area?: number | null
          project_id: string
          registry?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          suites?: number | null
          total_area?: number | null
          tower?: string | null
          type?: string | null
          uncovered_private_area?: number | null
          updated_at?: string
        }
        Update: {
          bedrooms?: number | null
          code?: string
          common_area?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          floor?: number | null
          floor_location_id?: string | null
          fractional_share?: number | null
          id?: string
          list_price?: number | null
          notes?: string | null
          parking_description?: string | null
          parking_spaces?: number | null
          position?: string | null
          private_area?: number | null
          project_id?: string
          registry?: string | null
          source_id?: string | null
          source_system?: string | null
          status?: string
          suites?: number | null
          total_area?: number | null
          tower?: string | null
          type?: string | null
          uncovered_private_area?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_floor_location_id_fkey"
            columns: ["floor_location_id"]
            isOneToOne: false
            referencedRelation: "engineering_takeoff_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      procurement_integrated_supply_control: {
        Row: {
          available_quantity: number | null
          baseline_id: string | null
          budget_balance: number | null
          category_snapshot: string | null
          code: string | null
          company_id: string | null
          consumed_quantity: number | null
          coverage_status: string | null
          delivery_deadline: string | null
          first_use_date: string | null
          input_id: string | null
          invoiced_quantity: number | null
          invoiced_value: number | null
          maximum_quantity: number | null
          minimum_quantity: number | null
          name: string | null
          on_hand_quantity: number | null
          order_deadline: string | null
          ordered_quantity: number | null
          ordered_value: number | null
          outstanding_order_quantity: number | null
          planned_total_cost: number | null
          planned_unit_cost: number | null
          project_id: string | null
          quotation_start: string | null
          received_quantity: number | null
          received_value: number | null
          rejected_quantity: number | null
          remaining_to_buy_quantity: number | null
          request_converted_quantity: number | null
          requested_quantity: number | null
          required_quantity: number | null
          reserved_quantity: number | null
          stock_value: number | null
          suggested_purchase_quantity: number | null
          supply_plan_item_id: string | null
          unit_snapshot: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engineering_supply_plan_items_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "engineering_schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_input_id_fkey"
            columns: ["input_id"]
            isOneToOne: false
            referencedRelation: "engineering_inputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "procurement_supplier_performance_raw_0066"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engineering_supply_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_supplier_performance: {
        Row: {
          accepted_quantity: number | null
          avg_delivery_days: number | null
          avg_resolution_days: number | null
          category: string | null
          classification: string | null
          company_id: string | null
          completeness_score: number | null
          conforming_price_items: number | null
          discrepancy_count: number | null
          documentation_score: number | null
          invoice_count: number | null
          invoice_item_count: number | null
          legal_name: string | null
          matched_invoices: number | null
          on_time_receipts: number | null
          order_count: number | null
          ordered_quantity: number | null
          ordered_value: number | null
          overall_score: number | null
          price_score: number | null
          project_id: string | null
          punctuality_score: number | null
          quality_score: number | null
          receipt_count: number | null
          rejected_quantity: number | null
          resolution_score: number | null
          resolved_discrepancy_count: number | null
          status: string | null
          supplier_id: string | null
          trade_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_supplier_performance_raw_0066: {
        Row: {
          accepted_quantity: number | null
          avg_delivery_days: number | null
          avg_resolution_days: number | null
          category: string | null
          classification: string | null
          company_id: string | null
          completeness_score: number | null
          conforming_price_items: number | null
          discrepancy_count: number | null
          documentation_score: number | null
          invoice_count: number | null
          invoice_item_count: number | null
          legal_name: string | null
          matched_invoices: number | null
          on_time_receipts: number | null
          order_count: number | null
          ordered_quantity: number | null
          ordered_value: number | null
          overall_score: number | null
          price_score: number | null
          project_id: string | null
          punctuality_score: number | null
          quality_score: number | null
          receipt_count: number | null
          rejected_quantity: number | null
          resolution_score: number | null
          resolved_discrepancy_count: number | null
          status: string | null
          supplier_id: string | null
          trade_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_execution_work_order: {
        Args: {
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_punch_list: Json | null
          p_quality_reference: string | null
          p_quality_status: string | null
          p_result: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      accept_execution_work_order_with_financial: {
        Args: {
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_punch_list: Json | null
          p_quality_reference: string | null
          p_quality_status: string | null
          p_result: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      activate_execution_service_contract: {
        Args: {
          p_company_id: string | null
          p_contract_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      add_company_member_by_email: {
        Args: { p_company_id: string | null; p_email: string | null; p_role_key: string | null }
        Returns: string
      }
      add_execution_service_contract_amendment: {
        Args: {
          p_company_id: string | null
          p_contract_id: string | null
          p_description: string | null
          p_justification: string | null
          p_new_end_date: string | null
          p_project_id: string | null
          p_type: string | null
          p_value_change: number | null
        }
        Returns: string
      }
      add_execution_service_contract_amendment_with_items: {
        Args: {
          p_company_id: string | null
          p_contract_id: string | null
          p_description: string | null
          p_items: Json | null
          p_justification: string | null
          p_new_end_date: string | null
          p_project_id: string | null
          p_type: string | null
          p_value_change: number | null
        }
        Returns: string
      }
      analyze_postwork_assistance_warranty: {
        Args: {
          p_asset_id: string | null
          p_company_id: string | null
          p_policy_id: string | null
          p_project_id: string | null
          p_reason: string | null
          p_status: string | null
          p_ticket_id: string | null
        }
        Returns: string
      }
      apply_procurement_inventory_balance: {
        Args: {
          p_batch_number: string | null
          p_company_id: string | null
          p_expiration_date: string | null
          p_input_id: string | null
          p_location_id: string | null
          p_project_id: string | null
          p_quantity_delta: number | null
          p_unit_cost: number | null
        }
        Returns: string
      }
      approve_execution_contract_measurement: {
        Args: {
          p_company_id: string | null
          p_measurement_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      approve_execution_daily_log: {
        Args: {
          p_company_id: string | null
          p_log_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_with_reservations?: boolean | null
        }
        Returns: string
      }
      approve_execution_material_request: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_request_id: string | null
        }
        Returns: string
      }
      approve_execution_service_competition: {
        Args: {
          p_company_id: string | null
          p_competition_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_winner_offer_id: string | null
        }
        Returns: string
      }
      approve_finance_electronic_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      approve_finance_manual_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      approve_procurement_material_quotation: {
        Args: {
          p_approval_notes: string | null
          p_awards: Json | null
          p_company_id: string | null
          p_project_id: string | null
          p_quotation_id: string | null
        }
        Returns: string
      }
      approve_procurement_material_receipt: {
        Args: {
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_receipt_id: string | null
        }
        Returns: string
      }
      archive_forecast_snapshot: {
        Args: { p_snapshot_id: string | null }
        Returns: undefined
      }
      bootstrap_company: {
        Args: {
          p_company_name: string | null
          p_company_slug: string | null
          p_project_code?: string | null
          p_project_name?: string | null
        }
        Returns: Json
      }
      can_view_profile: { Args: { target_user_id: string }; Returns: boolean }
      cancel_execution_contract_measurement: {
        Args: {
          p_company_id: string | null
          p_measurement_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_execution_daily_log: {
        Args: {
          p_company_id: string | null
          p_log_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_execution_material_request: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_reason: string | null
          p_request_id: string | null
        }
        Returns: string
      }
      cancel_finance_bank_transaction: {
        Args: {
          p_company_id: string | null
          p_reason: string | null
          p_transaction_id: string | null
        }
        Returns: string
      }
      cancel_finance_electronic_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_finance_manual_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_hr_payroll_run: {
        Args: { p_company_id: string | null; p_project_id: string | null; p_run_id: string | null }
        Returns: undefined
      }
      cancel_postwork_unit_inspection: {
        Args: {
          p_company_id: string | null
          p_inspection_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_postwork_warranty_asset: {
        Args: {
          p_asset_id: string | null
          p_company_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_procurement_material_quotation: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_quotation_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_procurement_material_receipt: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_reason: string | null
          p_receipt_id: string | null
        }
        Returns: string
      }
      cancel_procurement_purchase_order: {
        Args: {
          p_company_id: string | null
          p_order_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      cancel_quality_inspection: {
        Args: {
          p_company_id: string | null
          p_inspection_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      change_execution_service_contract_status: {
        Args: {
          p_action: string | null
          p_company_id: string | null
          p_contract_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      change_execution_service_request_status: {
        Args: {
          p_action: string | null
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_request_id: string | null
        }
        Returns: string
      }
      change_execution_work_order_status: {
        Args: {
          p_action: string | null
          p_company_id: string | null
          p_project_id: string | null
          p_reason: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      change_procurement_inventory_count_status: {
        Args: {
          p_action: string | null
          p_company_id: string | null
          p_count_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      change_procurement_inventory_reservation: {
        Args: {
          p_action: string | null
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_reservation_id: string | null
        }
        Returns: string
      }
      clone_company_role: {
        Args: {
          p_company_id: string | null
          p_description?: string | null
          p_name: string | null
          p_source_role_id: string | null
        }
        Returns: string
      }
      close_procurement_purchase_order: {
        Args: {
          p_company_id: string | null
          p_notes: string | null
          p_order_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      commercial_brokers_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      commercial_convert_proposal: {
        Args: {
          p_company_id: string | null
          p_contract_number?: string | null
          p_proposal_id: string | null
          p_sale_date: string | null
          p_user_id?: string | null
        }
        Returns: string
      }
      commercial_create_proposal_revision: {
        Args: {
          p_company_id: string | null
          p_proposal_id: string | null
          p_user_id?: string | null
          p_valid_until: string | null
        }
        Returns: string
      }
      commercial_generate_commission_payable: {
        Args: { p_commission_id: string | null }
        Returns: string
      }
      commercial_proposal_next_number: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_proposal_date?: string | null
        }
        Returns: string
      }
      commercial_proposals_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      commercial_set_commission_status: {
        Args: {
          p_commission_id: string | null
          p_company_id: string | null
          p_due_date?: string | null
          p_status: string | null
          p_user_id?: string | null
        }
        Returns: undefined
      }
      commercial_set_proposal_status: {
        Args: {
          p_company_id: string | null
          p_proposal_id: string | null
          p_reservation_until?: string | null
          p_status: string | null
          p_user_id?: string | null
        }
        Returns: undefined
      }
      complete_postwork_unit_inspection: {
        Args: {
          p_company_id: string | null
          p_general_notes: string | null
          p_inspection_id: string | null
          p_items: Json | null
          p_project_id: string | null
        }
        Returns: string
      }
      complete_postwork_warranty_maintenance: {
        Args: {
          p_company_id: string | null
          p_cost: number | null
          p_maintenance_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      complete_quality_inspection: {
        Args: {
          p_company_id: string | null
          p_inspection_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      confirm_procurement_purchase_order: {
        Args: {
          p_company_id: string | null
          p_confirmed_delivery_date: string | null
          p_notes: string | null
          p_order_id: string | null
          p_project_id: string | null
          p_reference: string | null
        }
        Returns: string
      }
      create_engineering_budget_item_composition_snapshot: {
        Args: { p_budget_item_id: string | null; p_created_by: string | null }
        Returns: string
      }
      create_execution_daily_log: {
        Args: {
          p_company_id: string | null
          p_copy_previous?: boolean | null
          p_diary_type?: string | null
          p_log_date: string | null
          p_project_id: string | null
          p_shift: string | null
        }
        Returns: string
      }
      create_forecast_snapshot: {
        Args: {
          p_actual_total: number | null
          p_baseline_id: string | null
          p_baseline_label: string | null
          p_budget_id: string | null
          p_budget_label: string | null
          p_budget_total: number | null
          p_committed_total: number | null
          p_company_id: string | null
          p_default_payment_days: number | null
          p_deviation_total: number | null
          p_engine_version: string | null
          p_forecast_as_of_date: string | null
          p_project_id: string | null
          p_projected_cost_total: number | null
          p_reference_month: string | null
          p_rows: Json | null
          p_source: string | null
          p_to_commit_total: number | null
          p_warnings: Json | null
        }
        Returns: string
      }
      create_hr_payroll_run: {
        Args: {
          p_company_id: string | null
          p_competence: string | null
          p_notes?: string | null
          p_project_id: string | null
          p_salary_due_date: string | null
        }
        Returns: string
      }
      create_manual_quality_inspection: {
        Args: {
          p_company_id: string | null
          p_due_date: string | null
          p_environment_name: string | null
          p_executor_team: string | null
          p_location_id: string | null
          p_project_id: string | null
          p_schedule_activity_id: string | null
          p_stage_name: string | null
          p_supplier_id: string | null
          p_template_id: string | null
          p_tower: string | null
          p_unit_name: string | null
        }
        Returns: string
      }
      create_postwork_unit_inspection: {
        Args: {
          p_access_notes: string | null
          p_client_id: string | null
          p_company_id: string | null
          p_contact_phone: string | null
          p_customer_attendee_name: string | null
          p_general_notes: string | null
          p_inspection_type: string | null
          p_inspector_name: string | null
          p_project_id: string | null
          p_scheduled_at: string | null
          p_template_id: string | null
          p_unit_id: string | null
        }
        Returns: string
      }
      create_postwork_warranty_asset: {
        Args: {
          p_brand: string | null
          p_company_id: string | null
          p_installation_date: string | null
          p_invoice_number: string | null
          p_item_name: string | null
          p_location_detail: string | null
          p_model: string | null
          p_notes: string | null
          p_policy_id: string | null
          p_project_id: string | null
          p_purchase_date: string | null
          p_serial_number: string | null
          p_start_date: string | null
          p_supplier_id: string | null
          p_unit_id: string | null
        }
        Returns: string
      }
      create_simple_execution_contract_measurement: {
        Args: {
          p_company_id: string | null
          p_competence: string | null
          p_contract_id: string | null
          p_gross_amount: number | null
          p_notes: string | null
          p_over_contract_confirmed: boolean | null
          p_progress_percent: number | null
          p_project_id: string | null
        }
        Returns: string
      }
      dearmor: { Args: { "": string }; Returns: string }
      delete_engineering_budget: {
        Args: {
          p_budget_id: string | null
          p_company_id: string | null
          p_project_id: string | null
        }
        Returns: undefined
      }
      delete_finance_manual_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      deliver_postwork_unit_inspection: {
        Args: {
          p_accepted_by_document: string | null
          p_accepted_by_name: string | null
          p_company_id: string | null
          p_delivery_notes: string | null
          p_energy: string | null
          p_gas: string | null
          p_inspection_id: string | null
          p_keys: number | null
          p_project_id: string | null
          p_rating: number | null
          p_tags: number | null
          p_water: string | null
        }
        Returns: string
      }
      engineering_normalize_text: { Args: { p_value: string }; Returns: string }
      engineering_outsourced_labor_label: {
        Args: { p_description: string | null; p_group_code: string | null }
        Returns: string
      }
      engineering_service_excludes_outsourced_labor: {
        Args: { p_description: string | null; p_group_code: string | null }
        Returns: boolean
      }
      engineering_sync_service_outsourced_labor: {
        Args: { p_service_id: string | null }
        Returns: Json
      }
      ensure_engineering_budget_item_composition: {
        Args: {
          p_budget_id: string | null
          p_budget_item_id: string | null
          p_company_id: string | null
        }
        Returns: string
      }
      ensure_procurement_inventory_location: {
        Args: { p_company_id: string | null; p_name: string | null; p_project_id: string | null }
        Returns: string
      }
      exception_release_quality_inspection: {
        Args: {
          p_company_id: string | null
          p_inspection_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      execution_daily_log_indicators: {
        Args: { p_company_id: string | null; p_project_id: string | null }
        Returns: Json
      }
      execution_work_order_indicators: {
        Args: { p_company_id: string | null; p_project_id: string | null }
        Returns: Json
      }
      finance_adjust_weekend: {
        Args: { p_date: string | null; p_mode: string | null }
        Returns: string
      }
      finance_bank_account_balance: {
        Args: { p_account_id: string | null; p_until_date?: string | null }
        Returns: number
      }
      finance_bank_accounts_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      finance_compute_tax_due_date: {
        Args: {
          p_competence_date: string | null
          p_first_installment_due_date: string | null
          p_issue_date: string | null
          p_tax_type_id: string | null
        }
        Returns: string
      }
      finance_generate_tax_payable: {
        Args: { p_obligation_id: string | null }
        Returns: string
      }
      finance_register_three_way_divergence: {
        Args: {
          p_actual_value: string | null
          p_description: string | null
          p_divergence_type: string | null
          p_expected_value: string | null
          p_invoice_id: string | null
          p_invoice_item_id: string | null
          p_rule_key: string | null
          p_severity: string | null
          p_snapshot: Json | null
          p_title: string | null
        }
        Returns: undefined
      }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      generate_execution_service_contract_from_competition: {
        Args: {
          p_adjustment_base_date: string | null
          p_adjustment_index: string | null
          p_company_id: string | null
          p_competition_id: string | null
          p_contact_email: string | null
          p_contact_name: string | null
          p_contact_phone: string | null
          p_end_date: string | null
          p_guarantee_months: number | null
          p_guarantee_percent: number | null
          p_notes: string | null
          p_payment_days: number | null
          p_project_id: string | null
          p_retention_percent: number | null
          p_scope_summary: string | null
          p_signed_date: string | null
          p_stages: Json | null
          p_start_date: string | null
          p_title: string | null
        }
        Returns: string
      }
      generate_execution_work_order_payables: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_work_order_id: string | null
        }
        Returns: number
      }
      generate_procurement_purchase_orders_from_quotation: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_quotation_id: string | null
        }
        Returns: Json
      }
      has_company_permission: {
        Args: { target_company_id: string | null; target_permission: string | null }
        Returns: boolean
      }
      import_engineering_input_prices: {
        Args: { p_company_id: string | null; p_rows: Json | null }
        Returns: Json
      }
      import_engineering_inputs: {
        Args: { p_company_id: string | null; p_rows: Json | null }
        Returns: Json
      }
      import_engineering_takeoffs: {
        Args: {
          p_budget_id: string | null
          p_company_id: string | null
          p_project_id: string | null
          p_rows: Json | null
        }
        Returns: Json
      }
      import_project_locations: {
        Args: { p_company_id: string | null; p_project_id: string | null; p_rows: Json | null }
        Returns: number
      }
      import_project_units: {
        Args: { p_company_id: string | null; p_project_id: string | null; p_rows: Json | null }
        Returns: number
      }
      is_company_member: {
        Args: { target_company_id: string | null }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_cnpj: { Args: { p_value: string }; Returns: boolean }
      issue_procurement_purchase_order: {
        Args: { p_company_id: string | null; p_order_id: string | null; p_project_id: string | null }
        Returns: string
      }
      manual_invoice_mutability: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_project_id: string | null
        }
        Returns: Json
      }
      mark_postwork_inspection_item_corrected: {
        Args: {
          p_company_id: string | null
          p_correction_notes: string | null
          p_inspection_id: string | null
          p_item_id: string | null
          p_project_id: string | null
          p_responsible_name: string | null
          p_supplier_id: string | null
        }
        Returns: string
      }
      open_procurement_material_quotation: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_quotation_id: string | null
        }
        Returns: string
      }
      pay_finance_payable: {
        Args: {
          p_account_id: string | null
          p_company_id: string | null
          p_paid_amount: number | null
          p_paid_at: string | null
          p_payable_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      payables_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      platform_create_environment: {
        Args: {
          p_company_name: string | null
          p_company_slug: string | null
          p_owner_email: string | null
          p_project_code?: string | null
          p_project_name?: string | null
        }
        Returns: Json
      }
      platform_list_environments: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          company_slug: string
          company_status: string
          created_at: string
          member_count: number
          owner_email: string
          project_count: number
        }[]
      }
      post_finance_bank_transaction: {
        Args: {
          p_account_id: string | null
          p_amount: number | null
          p_company_id: string | null
          p_competence_date: string | null
          p_counterparty: string | null
          p_description: string | null
          p_direction: string | null
          p_document: string | null
          p_notes: string | null
          p_project_id: string | null
          p_transaction_date: string | null
          p_transaction_type: string | null
        }
        Returns: string
      }
      post_hr_payroll_run: {
        Args: { p_company_id: string | null; p_project_id: string | null; p_run_id: string | null }
        Returns: number
      }
      post_procurement_inventory_movement: {
        Args: {
          p_batch_number: string | null
          p_company_id: string | null
          p_cost_center_service_id: string | null
          p_expiration_date: string | null
          p_from_location_id: string | null
          p_input_id: string | null
          p_movement_date: string | null
          p_movement_type: string | null
          p_notes: string | null
          p_project_id: string | null
          p_quantity: number | null
          p_recipient_name: string | null
          p_source_id: string | null
          p_source_reference: string | null
          p_source_type: string | null
          p_to_location_id: string | null
          p_unit_cost: number | null
        }
        Returns: string
      }
      postwork_assistance_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      postwork_inspections_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      postwork_next_assistance_number: {
        Args: {
          p_company_id: string | null
          p_opened_at?: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      postwork_next_inspection_number: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_reference_date?: string | null
        }
        Returns: {
          number: string
          sequence_no: number
        }[]
      }
      postwork_next_warranty_asset_code: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_reference_date?: string | null
        }
        Returns: string
      }
      postwork_set_assistance_status: {
        Args: {
          p_company_id: string | null
          p_notes?: string | null
          p_status: string | null
          p_ticket_id: string | null
          p_user_id?: string | null
          p_warranty_reason?: string | null
          p_warranty_status?: string | null
        }
        Returns: string
      }
      postwork_warranties_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      quality_next_number: {
        Args: { p_prefix: string | null; p_project_id: string | null; p_table: string | null }
        Returns: string
      }
      quality_populate_inspection_items: {
        Args: { p_inspection_id: string | null }
        Returns: number
      }
      recalculate_engineering_budget_item_from_composition: {
        Args: { p_composition_id: string | null }
        Returns: undefined
      }
      recalculate_execution_material_request_status: {
        Args: { p_request_id: string | null }
        Returns: string
      }
      receivable_month_distance: {
        Args: { p_base_month: string | null; p_target_month: string | null }
        Returns: number
      }
      receivables_summary: {
        Args: {
          p_company_id: string | null
          p_project_id?: string | null
          p_sale_id?: string | null
        }
        Returns: Json
      }
      receive_finance_receivable: {
        Args: {
          p_account_id: string | null
          p_company_id: string | null
          p_paid_amount: number | null
          p_paid_at: string | null
          p_project_id: string | null
          p_receivable_id: string | null
        }
        Returns: string
      }
      recompute_finance_electronic_invoice_three_way_match: {
        Args: { p_invoice_id: string | null }
        Returns: string
      }
      reconcile_finance_bank_transaction: {
        Args: {
          p_company_id: string | null
          p_reconciliation_date: string | null
          p_reference: string | null
          p_transaction_id: string | null
        }
        Returns: string
      }
      record_execution_schedule_progress: {
        Args: {
          p_activity_id: string | null
          p_actual_cost: number | null
          p_actual_finish: string | null
          p_actual_quantity: number | null
          p_actual_start: string | null
          p_baseline_id: string | null
          p_company_id: string | null
          p_current_finish: string | null
          p_current_start: string | null
          p_measurement_date: string | null
          p_notes: string | null
          p_progress_percent: number | null
          p_project_id: string | null
          p_team_count: number | null
        }
        Returns: string
      }
      refresh_execution_daily_log_completion: {
        Args: { p_log_id: string | null }
        Returns: number
      }
      refresh_execution_service_contract_measurements: {
        Args: { p_contract_id: string | null }
        Returns: undefined
      }
      refresh_execution_service_contract_value: {
        Args: { p_contract_id: string | null }
        Returns: number
      }
      refresh_execution_work_order_values: {
        Args: { p_work_order_id: string | null }
        Returns: undefined
      }
      refresh_finance_electronic_invoice: {
        Args: { p_invoice_id: string | null }
        Returns: undefined
      }
      refresh_finance_manual_invoice: {
        Args: { p_invoice_id: string | null }
        Returns: undefined
      }
      refresh_hr_payroll_run_totals: {
        Args: { p_run_id: string | null }
        Returns: undefined
      }
      refresh_procurement_material_quotation: {
        Args: { p_quotation_id: string | null }
        Returns: undefined
      }
      refresh_procurement_purchase_order: {
        Args: { p_order_id: string | null }
        Returns: string
      }
      refresh_quality_inspection: {
        Args: { p_inspection_id: string | null }
        Returns: number
      }
      refresh_sale_payment_plan_flag: {
        Args: { target_sale_id: string | null }
        Returns: undefined
      }
      register_approved_material_receipt_in_inventory: {
        Args: { p_receipt_id: string | null }
        Returns: undefined
      }
      reinspect_quality_nonconformity: {
        Args: {
          p_approved: boolean | null
          p_company_id: string | null
          p_nonconformity_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      reject_execution_contract_measurement: {
        Args: {
          p_company_id: string | null
          p_measurement_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      reject_finance_electronic_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      reject_finance_manual_invoice: {
        Args: {
          p_company_id: string | null
          p_invoice_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      reject_procurement_material_receipt: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_reason: string | null
          p_receipt_id: string | null
        }
        Returns: string
      }
      release_execution_work_order: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      remember_finance_supplier_product_mapping: {
        Args: {
          p_company_id: string | null
          p_description: string | null
          p_description_normalized: string | null
          p_ean: string | null
          p_input_id: string | null
          p_product_key: string | null
          p_supplier_id: string | null
          p_supplier_product_code: string | null
        }
        Returns: string
      }
      remove_engineering_budget_composition_item: {
        Args: {
          p_budget_id: string | null
          p_budget_item_id: string | null
          p_company_id: string | null
          p_item_id: string | null
        }
        Returns: undefined
      }
      remove_manual_invoice_generated_finance: {
        Args: { p_invoice_id: string | null }
        Returns: undefined
      }
      reopen_execution_daily_log: {
        Args: {
          p_company_id: string | null
          p_log_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      report_quality_correction: {
        Args: {
          p_company_id: string | null
          p_correction_report: string | null
          p_corrective_action: string | null
          p_estimated_cost: number | null
          p_nonconformity_id: string | null
          p_probable_cause: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      resolve_finance_electronic_invoice_divergence: {
        Args: {
          p_action: string | null
          p_company_id: string | null
          p_divergence_id: string | null
          p_invoice_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      return_execution_daily_log: {
        Args: {
          p_company_id: string | null
          p_log_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      reverse_execution_contract_measurement: {
        Args: {
          p_company_id: string | null
          p_measurement_id: string | null
          p_project_id: string | null
          p_reason: string | null
        }
        Returns: string
      }
      sales_summary: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: Json
      }
      save_and_post_finance_manual_invoice: {
        Args: {
          p_company_id: string | null
          p_competence_date: string | null
          p_contract_id: string | null
          p_document_number: string | null
          p_document_type: string | null
          p_installments: Json | null
          p_invoice_id: string | null
          p_issue_date: string | null
          p_items: Json | null
          p_material_receipt_id: string | null
          p_measurement_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_retentions: Json | null
          p_series: string | null
          p_supplier_id: string | null
        }
        Returns: string
      }
      save_company_role: {
        Args: {
          p_company_id: string | null
          p_description: string | null
          p_name: string | null
          p_role_id: string | null
          p_status?: string | null
        }
        Returns: string
      }
      save_engineering_budget_composition_item: {
        Args: {
          p_budget_id: string | null
          p_budget_item_id: string | null
          p_coefficient: number | null
          p_company_id: string | null
          p_input_id: string | null
          p_item_id: string | null
          p_notes: string | null
          p_sort_order: number | null
          p_unit_price: number | null
          p_waste_percentage: number | null
        }
        Returns: string
      }
      save_execution_contract_measurement: {
        Args: {
          p_advance_deduction: number | null
          p_company_id: string | null
          p_contract_id: string | null
          p_contractor_notes: string | null
          p_items: Json | null
          p_measurement_id: string | null
          p_notes: string | null
          p_other_discount: number | null
          p_over_contract_confirmed?: boolean | null
          p_period_end: string | null
          p_period_start: string | null
          p_project_id: string | null
          p_tax_withholding: number | null
        }
        Returns: string
      }
      save_execution_daily_log: {
        Args: {
          p_company_id: string | null
          p_confirmed: boolean | null
          p_general_notes: string | null
          p_log_id: string | null
          p_no_occurrences: boolean | null
          p_no_safety_events: boolean | null
          p_occurrences: Json | null
          p_project_id: string | null
          p_services: Json | null
          p_weather: Json | null
          p_work_end: string | null
          p_work_start: string | null
          p_workforce: Json | null
        }
        Returns: number
      }
      save_execution_material_request: {
        Args: {
          p_budget_id: string | null
          p_company_id: string | null
          p_items: Json | null
          p_needed_date: string | null
          p_notes: string | null
          p_project_id: string | null
          p_request_id: string | null
        }
        Returns: string
      }
      save_execution_service_competition_offer: {
        Args: {
          p_commercial_score: number | null
          p_company_id: string | null
          p_competition_id: string | null
          p_items: Json | null
          p_notes: string | null
          p_offer_id: string | null
          p_payment_days: number | null
          p_project_id: string | null
          p_proposal_date: string | null
          p_proposal_number: string | null
          p_proposed_finish: string | null
          p_proposed_start: string | null
          p_supplier_id: string | null
          p_technical_score: number | null
          p_validity_date: string | null
        }
        Returns: string
      }
      save_execution_service_contract: {
        Args: {
          p_adjustment_base_date: string | null
          p_adjustment_index: string | null
          p_budget_id: string | null
          p_company_id: string | null
          p_contact_email: string | null
          p_contact_name: string | null
          p_contact_phone: string | null
          p_contract_id: string | null
          p_end_date: string | null
          p_guarantee_months: number | null
          p_guarantee_percent: number | null
          p_items: Json | null
          p_notes: string | null
          p_payment_days: number | null
          p_project_id: string | null
          p_retention_percent: number | null
          p_scope_summary: string | null
          p_signed_date: string | null
          p_start_date: string | null
          p_supplier_id: string | null
          p_title: string | null
        }
        Returns: string
      }
      save_execution_service_contract_stages: {
        Args: {
          p_company_id: string | null
          p_contract_id: string | null
          p_project_id: string | null
          p_stages: Json | null
        }
        Returns: string
      }
      save_execution_service_request: {
        Args: {
          p_budget_id: string | null
          p_company_id: string | null
          p_items: Json | null
          p_needed_finish: string | null
          p_needed_start: string | null
          p_notes: string | null
          p_project_id: string | null
          p_request_id: string | null
          p_scope_summary: string | null
          p_title: string | null
        }
        Returns: string
      }
      save_execution_stage_contract_measurement: {
        Args: {
          p_advance_deduction: number | null
          p_company_id: string | null
          p_contract_id: string | null
          p_contractor_notes: string | null
          p_items: Json | null
          p_measurement_id: string | null
          p_notes: string | null
          p_other_discount: number | null
          p_period_end: string | null
          p_period_start: string | null
          p_project_id: string | null
          p_tax_withholding: number | null
        }
        Returns: string
      }
      save_execution_work_order: {
        Args: {
          p_company_id: string | null
          p_contract_id: string | null
          p_items: Json | null
          p_notes: string | null
          p_planned_finish: string | null
          p_planned_start: string | null
          p_prerequisites: Json | null
          p_project_id: string | null
          p_quality_requirements: string | null
          p_safety_instructions: string | null
          p_scope_summary: string | null
          p_site_instructions: string | null
          p_supplier_contact_name: string | null
          p_supplier_contact_phone: string | null
          p_title: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      save_execution_work_order_financial_plan: {
        Args: {
          p_company_id: string | null
          p_financial_mode: string | null
          p_installments: Json | null
          p_project_id: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      save_execution_work_order_with_financial_plan: {
        Args: {
          p_company_id: string | null
          p_contract_id: string | null
          p_financial_mode: string | null
          p_installments: Json | null
          p_items: Json | null
          p_notes: string | null
          p_planned_finish: string | null
          p_planned_start: string | null
          p_prerequisites: Json | null
          p_project_id: string | null
          p_quality_requirements: string | null
          p_safety_instructions: string | null
          p_scope_summary: string | null
          p_site_instructions: string | null
          p_supplier_contact_name: string | null
          p_supplier_contact_phone: string | null
          p_title: string | null
          p_work_order_id: string | null
        }
        Returns: string
      }
      save_finance_bank_account: {
        Args: {
          p_account_digit: string | null
          p_account_id: string | null
          p_account_number: string | null
          p_account_type: string | null
          p_agency: string | null
          p_allow_negative: boolean | null
          p_bank_code: string | null
          p_bank_name: string | null
          p_company_id: string | null
          p_is_default: boolean | null
          p_label: string | null
          p_legal_entity_id: string | null
          p_notes: string | null
          p_opening_balance: number | null
          p_opening_balance_date: string | null
          p_pix_key: string | null
          p_status: string | null
        }
        Returns: string
      }
      save_finance_electronic_invoice: {
        Args: {
          p_company_id: string | null
          p_installments: Json | null
          p_items: Json | null
          p_order_id: string | null
          p_payload: Json | null
          p_project_id: string | null
          p_receipt_id: string | null
          p_supplier_id: string | null
          p_xml_file_name: string | null
          p_xml_hash: string | null
          p_xml_storage_path: string | null
        }
        Returns: string
      }
      save_finance_manual_invoice: {
        Args: {
          p_company_id: string | null
          p_competence_date: string | null
          p_contract_id: string | null
          p_document_number: string | null
          p_document_type: string | null
          p_installments: Json | null
          p_invoice_id: string | null
          p_issue_date: string | null
          p_items: Json | null
          p_measurement_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_retentions: Json | null
          p_series: string | null
          p_submit: boolean | null
          p_supplier_id: string | null
        }
        Returns: string
      }
      save_postwork_inspection_template: {
        Args: {
          p_company_id: string | null
          p_inspection_type: string | null
          p_instructions: string | null
          p_items: Json | null
          p_name: string | null
          p_project_id: string | null
          p_template_id: string | null
        }
        Returns: string
      }
      save_postwork_warranty_policy: {
        Args: {
          p_alert_days: number | null
          p_category: string | null
          p_code: string | null
          p_company_id: string | null
          p_coverage_terms: string | null
          p_exclusions: string | null
          p_maintenance_requirements: string | null
          p_manufacturer: string | null
          p_name: string | null
          p_policy_id: string | null
          p_project_id: string | null
          p_scope_type: string | null
          p_start_rule: string | null
          p_status: string | null
          p_supplier_id: string | null
          p_term_months: number | null
        }
        Returns: string
      }
      save_procurement_inventory_count: {
        Args: {
          p_company_id: string | null
          p_count_date: string | null
          p_count_id: string | null
          p_items: Json | null
          p_location_id: string | null
          p_notes: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      save_procurement_inventory_location: {
        Args: {
          p_address: string | null
          p_allow_negative: boolean | null
          p_code: string | null
          p_company_id: string | null
          p_location_id: string | null
          p_name: string | null
          p_notes: string | null
          p_project_id: string | null
          p_responsible_name: string | null
          p_type: string | null
        }
        Returns: string
      }
      save_procurement_inventory_reservation: {
        Args: {
          p_balance_id: string | null
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_quantity: number | null
          p_required_date: string | null
          p_reservation_id: string | null
          p_service_id: string | null
          p_supply_plan_item_id: string | null
        }
        Returns: string
      }
      save_procurement_material_quotation: {
        Args: {
          p_award_mode: string | null
          p_company_id: string | null
          p_delivery_address: string | null
          p_desired_delivery_date: string | null
          p_items: Json | null
          p_notes: string | null
          p_payment_terms: string | null
          p_project_id: string | null
          p_quotation_id: string | null
          p_response_deadline: string | null
          p_suppliers: Json | null
          p_title: string | null
        }
        Returns: string
      }
      save_procurement_material_receipt: {
        Args: {
          p_arrival_time: string | null
          p_carrier_name: string | null
          p_company_id: string | null
          p_delivery_document: string | null
          p_driver_name: string | null
          p_general_condition: string | null
          p_invoice_access_key: string | null
          p_invoice_amount: number | null
          p_invoice_date: string | null
          p_invoice_number: string | null
          p_invoice_series: string | null
          p_items: Json | null
          p_notes: string | null
          p_order_id: string | null
          p_project_id: string | null
          p_receipt_date: string | null
          p_receipt_id: string | null
          p_vehicle_plate: string | null
          p_warehouse_location: string | null
        }
        Returns: string
      }
      save_procurement_material_supplier_offer: {
        Args: {
          p_company_id: string | null
          p_delivery_days: number | null
          p_freight_terms: string | null
          p_items: Json | null
          p_notes: string | null
          p_payment_terms: string | null
          p_project_id: string | null
          p_proposal_date: string | null
          p_proposal_number: string | null
          p_quotation_id: string | null
          p_supplier_id: string | null
          p_validity_date: string | null
          p_warranty_terms: string | null
        }
        Returns: string
      }
      save_procurement_purchase_order_header: {
        Args: {
          p_company_id: string | null
          p_delivery_address: string | null
          p_expected_delivery_date: string | null
          p_freight_terms: string | null
          p_notes: string | null
          p_order_id: string | null
          p_payment_terms: string | null
          p_project_id: string | null
          p_supplier_contact_email: string | null
          p_supplier_contact_name: string | null
          p_supplier_contact_phone: string | null
          p_supplier_notes: string | null
          p_warranty_terms: string | null
        }
        Returns: string
      }
      save_quality_inspection: {
        Args: {
          p_answers: Json | null
          p_company_id: string | null
          p_executor_confirmed: boolean | null
          p_executor_team: string | null
          p_general_notes: string | null
          p_inspection_id: string | null
          p_project_id: string | null
          p_supplier_id: string | null
        }
        Returns: number
      }
      save_quality_template: {
        Args: {
          p_change_notes: string | null
          p_code: string | null
          p_company_id: string | null
          p_criteria: Json | null
          p_criticality: string | null
          p_description: string | null
          p_evidence_rule: string | null
          p_has_blocking_gate: boolean | null
          p_inspection_unit: string | null
          p_name: string | null
          p_periodicity: string | null
          p_sampling_rule: string | null
          p_service_id: string | null
          p_service_weight: number | null
          p_template_id: string | null
        }
        Returns: string
      }
      save_schedule_service_weights: {
        Args: {
          p_baseline_id: string | null
          p_company_id: string | null
          p_project_id: string | null
          p_rows: Json | null
        }
        Returns: number
      }
      schedule_postwork_warranty_maintenance: {
        Args: {
          p_asset_id: string | null
          p_company_id: string | null
          p_due_date: string | null
          p_project_id: string | null
          p_supplier_id: string | null
          p_title: string | null
        }
        Returns: string
      }
      send_execution_contract_measurement_to_finance: {
        Args: {
          p_company_id: string | null
          p_due_date: string | null
          p_invoice_date: string | null
          p_invoice_gross_amount: number | null
          p_invoice_number: string | null
          p_measurement_id: string | null
          p_notes: string | null
          p_payment_method: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      set_company_member_role: {
        Args: { p_membership_id: string | null; p_role_key: string | null }
        Returns: undefined
      }
      set_company_role_permissions: {
        Args: {
          p_company_id: string | null
          p_permission_keys: string[] | null
          p_role_id: string | null
        }
        Returns: number
      }
      set_engineering_budget_base: {
        Args: {
          p_budget_id: string | null
          p_company_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      set_procurement_inventory_threshold: {
        Args: {
          p_balance_id: string | null
          p_company_id: string | null
          p_maximum: number | null
          p_minimum: number | null
          p_project_id: string | null
        }
        Returns: string
      }
      start_execution_service_competition: {
        Args: {
          p_award_criteria: string | null
          p_company_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_request_id: string | null
          p_response_deadline: string | null
        }
        Returns: string
      }
      start_postwork_unit_inspection: {
        Args: {
          p_company_id: string | null
          p_inspection_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      start_procurement_material_quotation_analysis: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_quotation_id: string | null
        }
        Returns: string
      }
      submit_execution_contract_measurement: {
        Args: {
          p_company_id: string | null
          p_measurement_id: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      submit_execution_daily_log: {
        Args: { p_company_id: string | null; p_log_id: string | null; p_project_id: string | null }
        Returns: string
      }
      submit_procurement_material_receipt: {
        Args: {
          p_company_id: string | null
          p_project_id: string | null
          p_receipt_id: string | null
        }
        Returns: string
      }
      sync_manual_invoice_retained_taxes: {
        Args: { p_invoice_id: string | null }
        Returns: number
      }
      sync_quality_inspections: {
        Args: { p_company_id: string | null; p_project_id: string | null }
        Returns: number
      }
      sync_supply_plan_inventory_for_input: {
        Args: { p_input_id: string | null; p_project_id: string | null }
        Returns: undefined
      }
      system_build_data_export: {
        Args: {
          p_company_id: string | null
          p_modules?: string[] | null
          p_project_id?: string | null
        }
        Returns: Json
      }
      system_cancel_data_restore: {
        Args: { p_reason: string | null; p_request_id: string | null }
        Returns: undefined
      }
      system_company_data_inventory: {
        Args: { p_company_id: string | null; p_project_id?: string | null }
        Returns: {
          module_key: string
          project_scoped: boolean
          row_count: number
          table_name: string
        }[]
      }
      system_complete_data_export: {
        Args: {
          p_checksum_sha256: string | null
          p_export_id: string | null
          p_file_name: string | null
          p_file_size: number | null
          p_metadata?: Json | null
          p_mime_type: string | null
          p_row_count: number | null
          p_storage_path: string | null
          p_table_count: number | null
        }
        Returns: undefined
      }
      system_create_data_export: {
        Args: {
          p_company_id: string | null
          p_format: string | null
          p_modules: string[] | null
          p_project_id: string | null
          p_retention_days?: number | null
          p_scope_type: string | null
        }
        Returns: string
      }
      system_data_module_for_table: {
        Args: { p_table_name: string | null }
        Returns: string
      }
      system_fail_data_export: {
        Args: { p_error_message: string | null; p_export_id: string | null }
        Returns: undefined
      }
      system_log_data_export_download: {
        Args: { p_export_id: string | null }
        Returns: undefined
      }
      system_mark_data_export_deleted: {
        Args: { p_export_id: string | null }
        Returns: undefined
      }
      system_request_data_restore: {
        Args: { p_export_id: string | null; p_reason: string | null }
        Returns: string
      }
      system_review_data_restore: {
        Args: { p_decision: string | null; p_notes: string | null; p_request_id: string | null }
        Returns: undefined
      }
      transfer_finance_bank_accounts: {
        Args: {
          p_amount: number | null
          p_company_id: string | null
          p_description: string | null
          p_from_account_id: string | null
          p_project_id: string | null
          p_to_account_id: string | null
          p_transfer_date: string | null
        }
        Returns: string
      }
      transfer_postwork_inspection_item_to_assistance: {
        Args: {
          p_company_id: string | null
          p_due_at: string | null
          p_inspection_id: string | null
          p_item_id: string | null
          p_priority: string | null
          p_project_id: string | null
        }
        Returns: string
      }
      transfer_procurement_inventory_between_projects: {
        Args: {
          p_company_id: string | null
          p_from_balance_id: string | null
          p_from_project_id: string | null
          p_notes: string | null
          p_quantity: number | null
          p_to_location_id: string | null
          p_to_project_id: string | null
        }
        Returns: string
      }
      update_execution_work_order_progress: {
        Args: {
          p_company_id: string | null
          p_items: Json | null
          p_notes: string | null
          p_project_id: string | null
          p_work_order_id: string | null
        }
        Returns: number
      }
      verify_postwork_inspection_item: {
        Args: {
          p_company_id: string | null
          p_inspection_id: string | null
          p_item_id: string | null
          p_notes: string | null
          p_project_id: string | null
          p_verification_result: string | null
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
    Enums: {},
  },
} as const
