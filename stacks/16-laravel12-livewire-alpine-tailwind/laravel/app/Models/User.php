<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    /** @return HasMany<Note, $this> */
    public function notes(): HasMany
    {
        return $this->hasMany(Note::class);
    }

    /**
     * A fixed, NON-SECRET bcrypt hash of a random throwaway string. Used to
     * burn one password verification for unknown emails so that response
     * timing does not reveal whether an account exists. It is not a
     * credential: knowing it verifies nothing.
     */
    public static function placeholderHash(): string
    {
        return '$2y$12$Yz6BDf1q8S0o8XYqGQ0qBeP5b8uJ0bHKwDZzCVQhbmER0P1TiOfWa';
    }
}
