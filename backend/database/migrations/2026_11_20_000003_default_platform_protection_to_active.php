<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('platform_bindings', function (Blueprint $table): void {
            $table->string('protection_status', 16)->default('active')->change();
        });

        DB::table('platform_bindings')
            ->where('protection_status', 'pending')
            ->whereNotExists(function (Builder $query): void {
                $query->selectRaw('1')
                    ->from('admin_audits')
                    ->where('action', 'protection.eligibility_changed')
                    ->whereColumn('admin_audits.member_id', 'platform_bindings.member_id')
                    ->whereColumn('admin_audits.details->binding_id', 'platform_bindings.id');
            })
            ->update(['protection_status' => 'active']);
    }

    public function down(): void
    {
        Schema::table('platform_bindings', function (Blueprint $table): void {
            $table->string('protection_status', 16)->default('pending')->change();
        });
    }
};
