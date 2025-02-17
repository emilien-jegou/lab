package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
)

func main() {
	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "auth-service is running",
		})
	})

	r.GET("/validate", func(c *gin.Context) {
		cookieToken, err := c.Cookie("token")
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"message": "unauthorized",
				"error":   "token missing",
			})
			return
		}

		valid, err := verifyToken(cookieToken)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"message": "unauthorized",
				"error":   err,
			})
			return
		}

		if valid {
			c.JSON(http.StatusOK, gin.H{
				"message": "authorized",
			})
		}
	})

	err := r.Run("0.0.0.0:9090")
	if err != nil {
		return
	}
}

func verifyToken(tokenString string) (bool, error) {
	jwtSecret := os.Getenv(("WEBUI_SECRET_KEY"))

	if len(jwtSecret) == 0 {
		return false, fmt.Errorf("JWT_SECRET env variable missing")
	}

	mySigningKey := []byte(jwtSecret)

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("error parsing jwt")
		}
		return mySigningKey, nil
	})
	if err != nil {
		return false, err
	}

	return token.Valid, nil
}
