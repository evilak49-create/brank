<?php

namespace App\Auth;

class MemberPhone
{
    public const RULE = 'regex:/\A[1-9][0-9]9[0-9]{8}\z/';

    public const REGISTRATION_RULE = 'regex:/\A(?:1[1-9]|2[12478]|3[1-57-8]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])9[0-9]{8}\z/';

    public const REGISTRATION_MESSAGE = '请输入有效的巴西手机号码（有效的地区区号 + 以 9 开头的 9 位号码）。';

    public static function mask(?string $phone): ?string
    {
        if ($phone === null || ! preg_match('/\A[0-9]{11}\z/', $phone)) {
            return null;
        }

        return substr($phone, 0, 3).'****'.substr($phone, -4);
    }

    public static function normalize(mixed $phone, bool $allowBareCountryCode = false): string
    {
        if (! is_string($phone) || strlen($phone) > 32 || ! preg_match('/\A(?:\+55)?[0-9 ()-]+\z/', $phone)) {
            return '';
        }

        if (str_starts_with($phone, '+55')) {
            return preg_replace('/[^0-9]/', '', substr($phone, 3));
        }

        $digits = preg_replace('/[^0-9]/', '', $phone);

        return $allowBareCountryCode && strlen($digits) === 13 && str_starts_with($digits, '55') ? substr($digits, 2) : $digits;
    }
}
