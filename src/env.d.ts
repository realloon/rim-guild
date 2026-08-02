declare namespace App {
	interface Locals {
		auth: {
			sessionToken: string
			profileToken: string
		} | null
	}
}
